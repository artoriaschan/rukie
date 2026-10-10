import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "@hono/bun";
import type { WSContext } from "hono/ws";
import { Context, Effect, FiberMap, Layer, ManagedRuntime } from "effect";
import { createSession, listSessions, type Session, type SessionOptions } from "@rukie/agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  type WireCommand,
  type WireErrorCode,
  type WireResponse,
  type WireProject,
  type WireSessionSummary,
  WIRE_SUBPROTOCOL,
} from "@rukie/shared";
import { parseWireCommand } from "./command.ts";

const RegistrySchema = Type.Object({
  projects: Type.Array(
    Type.Object({ id: Type.String(), path: Type.String(), name: Type.String() }),
  ),
  pinned: Type.Array(Type.String()),
  preferences: Type.Object({}),
});
type Registry = Static<typeof RegistrySchema>;
export interface ServerOptions {
  homeDir: string;
  development?: boolean;
  /** Model network boundary overrides for isolated frontend acceptance. */
  sessionOptions?: Pick<SessionOptions, "model" | "models" | "settings">;
  onWarning?: (warning: string) => void;
  /** Defaults to a single stdout JSON handshake. */
  onHandshake?: (connection: { port: number; token: string }) => void;
}
class CommandError extends Error {
  constructor(readonly code: WireErrorCode) {
    super(code);
  }
}
const AgentCore = Context.Service<{ open: (cwd: string, resumeId?: string) => Promise<Session> }>(
  "server/AgentCore",
);
const DesktopRegistry = Context.Service<{
  value: Registry;
  workspace: string;
  save: () => Promise<void>;
}>("server/DesktopRegistry");
const Runs = Context.Service<FiberMap.FiberMap<string, unknown, unknown>>("server/Runs");

/** Owns the loopback listener and all Sessions; disconnect only releases socket subscriptions. */
export async function startServer(options: ServerOptions) {
  const warning = options.onWarning ?? console.warn;
  const directory = join(options.homeDir, ".rukie", "desktop");
  const workspace = join(directory, "workspace");
  await mkdir(workspace, { recursive: true });
  const file = join(directory, "registry.json");
  let registry: Registry = { projects: [], pinned: [], preferences: {} };
  try {
    const input: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!Value.Check(RegistrySchema, input)) throw new Error("Invalid desktop registry");
    registry = input;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  let writes = Promise.resolve();
  const save = () => {
    const text = JSON.stringify(registry);
    writes = writes.then(async () => {
      await writeFile(`${file}.tmp`, text);
      await rename(`${file}.tmp`, file);
    });
    return writes;
  };
  const sessions = new Map<string, Session>();
  const openings = new Map<string, Promise<Session>>();
  const open = (cwd: string, resumeId?: string) => {
    const current = resumeId ? sessions.get(resumeId) : undefined;
    if (current) return Promise.resolve(current);
    const key = resumeId ?? crypto.randomUUID();
    const existing = openings.get(key);
    if (existing) return existing;
    const opening = createSession({
      ...options.sessionOptions,
      cwd,
      homeDir: options.homeDir,
      resumeId,
      onWarning: warning,
    })
      .then((session) => {
        sessions.set(session.id, session);
        return session;
      })
      .finally(() => openings.delete(key));
    openings.set(key, opening);
    return opening;
  };
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      Layer.succeed(AgentCore, { open }),
      Layer.succeed(DesktopRegistry, { value: registry, workspace, save }),
      Layer.effect(Runs, FiberMap.make<string>()),
    ),
  );
  const summaries = async (): Promise<WireSessionSummary[]> =>
    (
      await Promise.all(
        [workspace, ...registry.projects.map((p) => p.path)].map(async (cwd) => {
          try {
            return (await listSessions({ cwd, homeDir: options.homeDir, onWarning: warning })).map(
              (session) => ({ ...session, cwd }),
            );
          } catch (error) {
            warning(String(error));
            return [];
          }
        }),
      )
    ).flat();
  const find = async (id: string) => {
    const current = sessions.get(id);
    if (current) return current;
    const summary = (await summaries()).find((s) => s.id === id);
    if (!summary) throw new CommandError("session_not_found");
    return open(summary.cwd, id);
  };
  let active: WSContext | undefined;
  const subscriptions = new Map<unknown, Map<string, () => void>>();
  const send = (socket: WSContext, value: unknown) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(value));
  };
  const release = (socket: WSContext) => {
    for (const unsubscribe of subscriptions.get(socket.raw)?.values() ?? []) unsubscribe();
    subscriptions.delete(socket.raw);
  };
  const subscribe = (socket: WSContext, session: Session) => {
    const subscribed = subscriptions.get(socket.raw);
    if (!subscribed) return;
    if (!subscribed.has(session.id))
      subscribed.set(
        session.id,
        session.subscribe((event) => send(socket, event)),
      );
  };
  const startRun = (
    session: Session,
    text: string,
    images?: Extract<WireCommand, { type: "prompt" }>["images"],
  ) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const runs = yield* Runs;
        if (FiberMap.hasUnsafe(runs, session.id)) throw new CommandError("session_busy");
        yield* FiberMap.run(
          runs,
          session.id,
          Effect.tryPromise({
            try: (signal) => session.run(text, { signal, images }),
            catch: (error) => {
              warning(String(error));
              return error;
            },
          }),
          { onlyIfMissing: true },
        );
      }),
    );
  const dispatch = async (command: WireCommand, socket: WSContext): Promise<unknown> => {
    switch (command.type) {
      case "projects.list":
        return runtime.runPromise(
          Effect.gen(function* () {
            return (yield* DesktopRegistry).value.projects;
          }),
        );
      case "project.add": {
        if (
          !isAbsolute(command.path) ||
          !(await stat(command.path).catch(() => undefined))?.isDirectory()
        )
          throw new CommandError("project_not_found");
        const path = resolve(command.path);
        let project: WireProject | undefined = registry.projects.find((p) => p.path === path);
        if (!project) {
          project = { id: crypto.randomUUID(), path, name: basename(path) };
          registry.projects.push(project);
          await save();
        }
        return project;
      }
      case "sessions.list":
        return summaries();
      case "session.create": {
        const cwd =
          command.project === null
            ? workspace
            : registry.projects.find((p) => p.id === command.project)?.path;
        if (!cwd) throw new CommandError("project_not_found");
        const session = await runtime.runPromise(
          Effect.gen(function* () {
            const core = yield* AgentCore;
            return yield* Effect.promise(() => core.open(cwd));
          }),
        );
        subscribe(socket, session);
        await startRun(session, command.text, command.images);
        return { sessionId: session.id };
      }
      case "session.subscribe": {
        const session = await find(command.sessionId);
        subscribe(socket, session);
        return { sessionId: session.id };
      }
      case "session.unsubscribe":
        subscriptions.get(socket.raw)?.get(command.sessionId)?.();
        subscriptions.get(socket.raw)?.delete(command.sessionId);
        return {};
      case "prompt": {
        const session = await find(command.sessionId);
        if (session.running) throw new CommandError("session_busy");
        await startRun(session, command.text, command.images);
        return {};
      }
      case "abort": {
        const session = await find(command.sessionId);
        const inputs = await session.abort();
        await runtime.runPromise(
          Effect.gen(function* () {
            yield* FiberMap.remove(yield* Runs, session.id);
          }),
        );
        return { inputs };
      }
      default:
        throw new CommandError("invalid_command");
    }
  };
  const token = randomBytes(32).toString("hex");
  let port = 0;
  const app = new Hono();
  app.use("/ws", async (c, next) => {
    const protocols =
      c.req
        .header("sec-websocket-protocol")
        ?.split(",")
        .map((p) => p.trim()) ?? [];
    const supplied = protocols[1]?.startsWith("rukie.auth.") ? protocols[1].slice(11) : "";
    const origin = c.req.header("origin");
    if (
      c.req.header("host") !== `127.0.0.1:${port}` ||
      !(origin === "app://rukie" || (options.development && origin === "http://localhost:5173"))
    )
      return c.text("Forbidden", 403);
    if (
      protocols[0] !== WIRE_SUBPROTOCOL ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
    )
      return c.text("Unauthorized", 401);
    await next();
  });
  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(_event, socket) {
        if (active) {
          release(active);
          active.close(4000, "superseded");
        }
        active = socket;
        subscriptions.set(socket.raw, new Map());
      },
      onClose(_event, socket) {
        release(socket);
        if (active?.raw === socket.raw) active = undefined;
      },
      onMessage(event, socket) {
        let input: unknown;
        try {
          input = JSON.parse(String(event.data));
        } catch {
          send(socket, { type: "response", id: "", error: { code: "invalid_command" } });
          return;
        }
        const command = parseWireCommand(input);
        if (!command) {
          send(socket, {
            type: "response",
            id:
              typeof input === "object" &&
              input !== null &&
              "id" in input &&
              typeof input.id === "string"
                ? input.id
                : "",
            error: { code: "invalid_command" },
          });
          return;
        }
        void dispatch(command, socket).then(
          (result) =>
            send(socket, { type: "response", id: command.id, result } satisfies WireResponse),
          (error) => {
            const code =
              error instanceof CommandError
                ? error.code
                : error instanceof Error && "code" in error && error.code === "session-busy"
                  ? "session_busy"
                  : "internal";
            if (code === "internal") warning(String(error));
            send(socket, { type: "response", id: command.id, error: { code } });
          },
        );
      },
    })),
  );
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
  port = server.port!;
  (options.onHandshake ?? ((connection) => console.log(JSON.stringify(connection))))({
    port,
    token,
  });
  let closing: Promise<void> | undefined;
  return {
    port,
    token,
    close: () =>
      (closing ??= (async () => {
        if (active) {
          release(active);
          active.close(1001, "shutdown");
        }
        await runtime.dispose();
        await Promise.allSettled(openings.values());
        await Promise.all([...sessions.values()].map((s) => s.close("exit")));
        await writes;
        await server.stop(true);
      })()),
  };
}
