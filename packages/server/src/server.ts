import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "@hono/bun";
import type { WSContext } from "hono/ws";
import { Context, Effect, FiberMap, Layer, ManagedRuntime } from "effect";
import {
  createSession,
  listSessions,
  readSessionSnapshot,
  listModelCatalog,
  loadSettings,
  type PermissionAskRequest,
  type Session,
  type SessionOptions,
} from "@rukie/agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  type WireCommand,
  type WireErrorCode,
  type WireResponse,
  type WireProject,
  type WireSessionSummary,
  WIRE_SUBPROTOCOL,
  WirePreferencesSchema,
} from "@rukie/shared";
import { parseWireCommand } from "./command.ts";

const RegistrySchema = Type.Object({
  projects: Type.Array(
    Type.Object({ id: Type.String(), path: Type.String(), name: Type.String() }),
  ),
  pinned: Type.Array(Type.String()),
  preferences: WirePreferencesSchema,
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
const AgentCore = Context.Service<{
  open: (
    cwd: string,
    resumeId?: string,
    initial?: Extract<WireCommand, { type: "session.create" }>,
  ) => Promise<Session>;
}>("server/AgentCore");
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
  const pending = new Map<
    string,
    {
      sessionId: string;
      request: Omit<PermissionAskRequest, "signal">;
      settle: (reply: "allow" | "deny" | "allow-session") => void;
    }
  >();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const observations = new Map<string, () => void>();
  const children = new Map<string, boolean>();
  const admissions = new Map<string, number>();
  const retirements = new Set<Promise<void>>();
  const commands = new Set<Promise<unknown>>();
  let shuttingDown = false;
  const held = (session: Session) =>
    (admissions.get(session.id) ?? 0) > 0 ||
    session.running ||
    session.queuedInputs.length ||
    children.get(session.id) ||
    session.jobs().some((job) => job.status === "running" || job.status === "stopping") ||
    [...pending.values()].some((item) => item.sessionId === session.id) ||
    [...subscriptions.values()].some((map) => map.has(session.id));
  const refreshIdle = (session: Session) => {
    if (shuttingDown) return;
    clearTimeout(idleTimers.get(session.id));
    idleTimers.delete(session.id);
    if (held(session)) return;
    idleTimers.set(
      session.id,
      setTimeout(
        () => {
          idleTimers.delete(session.id);
          if (held(session)) return;
          observations.get(session.id)?.();
          observations.delete(session.id);
          sessions.delete(session.id);
          children.delete(session.id);
          const retirement = session.close().then(() => changed(session.id));
          retirements.add(retirement);
          void retirement.then(
            () => retirements.delete(retirement),
            (error) => {
              retirements.delete(retirement);
              warning(String(error));
            },
          );
        },
        10 * 60 * 1000,
      ),
    );
  };
  const openings = new Map<string, Promise<Session>>();
  const open = (
    cwd: string,
    resumeId?: string,
    initial?: Extract<WireCommand, { type: "session.create" }>,
  ) => {
    const current = resumeId ? sessions.get(resumeId) : undefined;
    if (current) return Promise.resolve(current);
    const key = resumeId ?? crypto.randomUUID();
    const existing = openings.get(key);
    if (existing) return existing;
    let owner: Session | undefined;
    const opening = (async () => {
      const settings =
        options.sessionOptions?.settings ??
        (await loadSettings({ cwd, homeDir: options.homeDir })).settings;
      return createSession({
        ...options.sessionOptions,
        settings: initial?.modelSelection
          ? {
              ...settings,
              model: `${initial.modelSelection.provider}/${initial.modelSelection.modelId}`,
              thinking: initial.modelSelection.thinkingLevel,
            }
          : settings,
        model: initial?.modelSelection
          ? options.sessionOptions?.models?.getModel(
              initial.modelSelection.provider,
              initial.modelSelection.modelId,
            )
          : options.sessionOptions?.model,
        permissionMode: initial?.permissionMode,
        cwd,
        homeDir: options.homeDir,
        resumeId,
        onWarning: warning,
        onPermissionAsk: (request) =>
          new Promise((resolve) => {
            const { signal, ...payload } = request;
            const sessionId = owner?.id ?? resumeId ?? "";
            const settle = (reply: "allow" | "deny" | "allow-session") => {
              if (!pending.delete(request.identity.epoch)) return;
              signal.removeEventListener("abort", cancel);
              if (active)
                send(active, {
                  type: "interaction_settled",
                  sessionId,
                  identity: request.identity,
                });
              resolve(reply);
            };
            const cancel = () => settle("deny");
            pending.set(request.identity.epoch, { sessionId, request: payload, settle });
            signal.addEventListener("abort", cancel, { once: true });
            if (signal.aborted) cancel();
            else if (active)
              send(active, {
                type: "interaction_requested",
                sessionId,
                identity: request.identity,
                request: payload,
              });
          }),
      });
    })()
      .then((session) => {
        owner = session;
        sessions.set(session.id, session);
        observations.set(
          session.id,
          session.subscribe((event) => {
            if (event.type === "snapshot")
              children.set(
                session.id,
                event.background.some((child) => child.active),
              );
            refreshIdle(session);
            if (event.type === "run_start" || event.type === "run_end" || event.type === "result")
              void changed().catch((error) => warning(String(error)));
          }),
        );
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
              (summary) => ({
                ...summary,
                cwd,
                running: sessions.get(summary.id)?.running ?? false,
                waitingPermission: [...pending.values()].some(
                  (item) => item.sessionId === summary.id,
                ),
              }),
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
  const changed = async (closedSessionId?: string) => {
    if (active)
      send(active, {
        type: "sessions_changed",
        ...(closedSessionId ? { closedSessionId } : {}),
        sessions: await summaries(),
        projects: registry.projects,
        pinned: registry.pinned,
        preferences: registry.preferences,
      });
  };
  const release = (socket: WSContext) => {
    for (const unsubscribe of subscriptions.get(socket.raw)?.values() ?? []) unsubscribe();
    subscriptions.delete(socket.raw);
    for (const session of sessions.values()) refreshIdle(session);
  };
  const state = (socket: WSContext, session: Session) =>
    send(socket, {
      type: "session_state",
      sessionId: session.id,
      permissionMode: session.permissionMode,
      thinkingLevel: session.thinkingLevel,
      contextReport: session.contextReport(),
    });
  const subscribe = (socket: WSContext, session: Session) => {
    const subscribed = subscriptions.get(socket.raw);
    if (!subscribed) return;
    if (!subscribed.has(session.id))
      subscribed.set(
        session.id,
        session.subscribe((event) => {
          send(socket, event);
          if (
            event.type === "snapshot" ||
            event.type === "result" ||
            event.type === "context_usage"
          )
            state(socket, session);
        }),
      );
    refreshIdle(session);
    for (const item of pending.values()) {
      if (item.sessionId === session.id)
        send(socket, {
          type: "interaction_requested",
          sessionId: session.id,
          identity: item.request.identity,
          request: item.request,
        });
    }
  };
  const startRun = async (
    session: Session,
    text: string,
    images?: Extract<WireCommand, { type: "prompt" }>["images"],
  ) => {
    admissions.set(session.id, (admissions.get(session.id) ?? 0) + 1);
    refreshIdle(session);
    try {
      const requestId = await session.followUp(text, { images });
      await runtime.runPromise(
        Effect.gen(function* () {
          yield* FiberMap.run(
            yield* Runs,
            requestId,
            Effect.tryPromise({
              try: async (signal) => {
                const cancel = () => {
                  if (!shuttingDown) void session.abort().catch((error) => warning(String(error)));
                };
                signal.addEventListener("abort", cancel, { once: true });
                try {
                  const result = await session.waitForRequest(requestId);
                  return result;
                } finally {
                  signal.removeEventListener("abort", cancel);
                  refreshIdle(session);
                }
              },
              catch: (error) => {
                warning(String(error));
                return error;
              },
            }).pipe(Effect.catch(() => Effect.void)),
          );
        }),
      );
      return requestId;
    } finally {
      admissions.set(session.id, (admissions.get(session.id) ?? 1) - 1);
      refreshIdle(session);
    }
  };
  const dispatch = async (command: WireCommand, socket: WSContext): Promise<unknown> => {
    if (shuttingDown) throw new CommandError("internal");
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
        await changed();
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
            return yield* Effect.promise(() => core.open(cwd, undefined, command));
          }),
        );
        subscribe(socket, session);
        const requestId = await startRun(session, command.text, command.images);
        await changed();
        return { sessionId: session.id, requestId };
      }
      case "session.subscribe": {
        try {
          const session = await find(command.sessionId);
          subscribe(socket, session);
          return { sessionId: session.id };
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "session-busy"))
            throw error;
          const summary = (await summaries()).find((session) => session.id === command.sessionId);
          if (summary)
            send(
              socket,
              await readSessionSnapshot({
                cwd: summary.cwd,
                homeDir: options.homeDir,
                id: summary.id,
              }),
            );
          throw error;
        }
      }
      case "session.unsubscribe":
        subscriptions.get(socket.raw)?.get(command.sessionId)?.();
        subscriptions.get(socket.raw)?.delete(command.sessionId);
        if (sessions.has(command.sessionId)) refreshIdle(sessions.get(command.sessionId)!);
        return {};
      case "prompt": {
        const session = await find(command.sessionId);
        const requestId = await startRun(session, command.text, command.images);
        return { requestId };
      }
      case "abort": {
        const session = await find(command.sessionId);
        const inputs = await session.abort();
        refreshIdle(session);
        return { inputs };
      }
      case "withdraw": {
        const result = await (await find(command.sessionId)).withdraw(command.requestId);
        if (result.status === "not_queued") throw new CommandError("not_queued");
        return { input: result.input };
      }
      case "steer_now": {
        const result = await (await find(command.sessionId)).steerNow(command.requestId);
        if (result.status === "not_queued") throw new CommandError("not_queued");
        return result;
      }
      case "interaction.reply": {
        const item = pending.get(command.identity.epoch);
        if (
          !item ||
          item.request.identity.requestId !== command.identity.requestId ||
          item.request.identity.taskId !== command.identity.taskId ||
          item.request.identity.conversationId !== command.identity.conversationId
        )
          throw new CommandError("interaction_stale");
        item.settle(command.reply);
        return {};
      }
      case "models.list": {
        const settings =
          options.sessionOptions?.settings ??
          (await loadSettings({ cwd: workspace, homeDir: options.homeDir })).settings;
        return listModelCatalog(settings, options.sessionOptions?.models);
      }
      case "session.set_model": {
        const session = await find(command.sessionId);
        if (session.running) throw new CommandError("session_busy");
        const result = await session.setModelSelection({
          model: `${command.provider}/${command.modelId}`,
          thinkingLevel: command.thinkingLevel,
        });
        state(socket, session);
        await changed();
        return result;
      }
      case "session.set_permission_mode": {
        const session = await find(command.sessionId);
        session.setPermissionMode(command.mode);
        state(socket, session);
        await changed();
        return { mode: command.mode };
      }
      case "session.pin":
      case "session.unpin": {
        if (!(await summaries()).some((session) => session.id === command.sessionId))
          throw new CommandError("session_not_found");
        registry.pinned = registry.pinned.filter((id) => id !== command.sessionId);
        if (command.type === "session.pin") registry.pinned.push(command.sessionId);
        await save();
        await changed();
        return {};
      }
      case "preferences.set":
        registry.preferences = { ...registry.preferences, ...command.preferences };
        await save();
        await changed();
        return registry.preferences;
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
        void changed().catch((error) => warning(String(error)));
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
        if (active?.raw !== socket.raw || shuttingDown) return;
        const task = dispatch(command, socket);
        commands.add(task);
        void task
          .then(
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
          )
          .finally(() => commands.delete(task));
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
        shuttingDown = true;
        if (active) {
          release(active);
          active.close(1001, "shutdown");
        }
        for (const timer of idleTimers.values()) clearTimeout(timer);
        idleTimers.clear();
        for (const unsubscribe of observations.values()) unsubscribe();
        observations.clear();
        await Promise.allSettled(commands);
        await Promise.allSettled(openings.values());
        await Promise.allSettled(retirements);
        let failure: unknown;
        const releaseResource = async (work: () => Promise<unknown>) => {
          try {
            await work();
          } catch (error) {
            failure ??= error;
          }
        };
        await releaseResource(async () => {
          const results = await Promise.allSettled(
            [...sessions.values()].map((session) => session.abort()),
          );
          const rejected = results.find((result) => result.status === "rejected");
          if (rejected?.status === "rejected") throw rejected.reason;
        });
        await releaseResource(() => runtime.dispose());
        await releaseResource(async () => {
          const results = await Promise.allSettled(
            [...sessions.values()].map((session) => session.close("exit")),
          );
          const rejected = results.find((result) => result.status === "rejected");
          if (rejected?.status === "rejected") throw rejected.reason;
        });
        await releaseResource(() => writes);
        await releaseResource(() => server.stop(true));
        if (failure !== undefined) throw failure;
      })()),
  };
}
