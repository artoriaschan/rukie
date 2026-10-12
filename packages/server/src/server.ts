import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "@hono/bun";
import type { WSContext } from "hono/ws";
import { Context, Effect, FiberMap, Layer, ManagedRuntime } from "effect";
import {
  createSession,
  createApplicationModels,
  applicationModelTemplates,
  listSessions,
  discoverSqliteSessions,
  isSqliteSessionBusy,
  readSessionSnapshot,
  readSessionToolOutput,
  listModelCatalog,
  loadSettings,
  type PermissionAskRequest,
  type Session,
  type SessionOptions,
} from "@rukie/agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  type WireCommand,
  type WireErrorCode,
  type WireResponse,
  type WireProject,
  type WireSessionSummary,
  WIRE_SUBPROTOCOL,
  ModelServiceSchema,
  ModelPriceRequestSchema,
} from "@rukie/shared";
import { lookupModelPrices } from "./model-prices.ts";
import { parseWireCommand } from "./command.ts";
import { AppDatabase, type ApplicationRegistry } from "./storage/app-database.ts";
import { secretVault, type SecretEncryption, type EncryptionBackend } from "./storage/secrets.ts";
import { applicationMcpPersistence, applicationConfiguration } from "./storage/configuration.ts";

type Registry = ApplicationRegistry;
export interface ServerOptions {
  homeDir: string;
  /** Application-owned root, distinct from tool/permission home. No shared-path fallback. */
  dataRoot: string;
  /** Optional shared configuration; Sessions and project registry stay in dataRoot. */
  configurationRoot?: string;
  development?: boolean;
  /** Private main/sidecar channel; never included in the renderer handshake. */
  managementToken?: string;
  encryption?: SecretEncryption;
  /** Typed callers default to Electron; process startup always supplies an explicit backend. */
  encryptionBackend?: EncryptionBackend;
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
  if (!isAbsolute(options.dataRoot)) throw new Error("Desktop dataRoot must be absolute.");
  if (options.configurationRoot && !isAbsolute(options.configurationRoot))
    throw new Error("Desktop configurationRoot must be absolute.");
  const directory = options.dataRoot;
  const workspace = join(directory, "workspace");
  await mkdir(workspace, { recursive: true });
  const database = await AppDatabase.open(options.configurationRoot ?? directory);
  let localDatabase = database;
  const sharedConfiguration =
    options.configurationRoot !== undefined && options.configurationRoot !== directory;
  let closeListener: (() => Promise<unknown>) | undefined;
  try {
    if (sharedConfiguration) localDatabase = await AppDatabase.open(directory);
    const vault = secretVault(database, options.encryption);
    const configuration = applicationConfiguration(database, vault, options.encryption);
    const presentationSettings = async (cwd: string) =>
      options.sessionOptions?.settings ??
      (
        await loadSettings({
          cwd,
          homeDir: options.homeDir,
          dataRoot: options.dataRoot,
          userSettings: await database.settings(),
        })
      ).settings;
    const registry = await localDatabase.registry();
    if (sharedConfiguration) registry.preferences = await database.preferences();
    const configuredModels = async () =>
      createApplicationModels({
        providers: await database.providers(),
        homeDir: options.homeDir,
        hasCredential: async (id) => (await database.credential(`provider:${id}`)) !== undefined,
        credential: (id) => vault.read(`provider:${id}`),
        capabilityStore: {
          read: (key) => database.capability(key),
          save: (key, value) => database.saveCapability(key, value),
        },
      });
    // Defaults are desktop provider metadata; Session persists the adopted choice.
    const modelDefault = async (provider: string, modelId: string) =>
      (await database.providers())
        .find((item) => item.id === provider)
        ?.models.find((item) => item.id === modelId)?.defaultThinkingLevel;
    const applicationModels = await configuredModels();
    const refreshModels = async () => {
      const next = await configuredModels();
      applicationModels.clearProviders();
      for (const provider of next.getProviders()) applicationModels.setProvider(provider);
    };
    const save = async () => {
      try {
        await localDatabase.saveRegistry(
          sharedConfiguration ? { ...registry, preferences: {} } : registry,
        );
      } catch (error) {
        Object.assign(registry, await localDatabase.registry());
        if (sharedConfiguration) registry.preferences = await database.preferences();
        throw error;
      }
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
    const changes = new Set<Promise<void>>();
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
      resumeModelSelection?: SessionOptions["resumeModelSelection"],
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
          (
            await loadSettings({
              cwd,
              homeDir: options.homeDir,
              dataRoot: options.dataRoot,
              userSettings: await configuration.settings(),
            })
          ).settings;
        await refreshModels();
        const models = options.sessionOptions?.models ?? applicationModels;
        const spec = initial?.modelSelection
          ? `${initial.modelSelection.provider}/${initial.modelSelection.modelId}`
          : (resumeModelSelection?.model ??
            (resumeId
              ? (
                  await listSessions({ cwd, homeDir: options.homeDir, dataRoot: options.dataRoot })
                ).find((summary) => summary.id === resumeId)?.model
              : settings.model));
        const selected = spec
          ? models.getModel(spec.split("/")[0]!, spec.slice(spec.indexOf("/") + 1))
          : undefined;
        if (
          !options.sessionOptions?.model &&
          (!selected || !(await models.checkAuth(selected.provider)))
        )
          throw new CommandError("model_unavailable");
        return createSession({
          ...options.sessionOptions,
          models,
          settings: initial?.modelSelection
            ? {
                ...settings,
                model: `${initial.modelSelection.provider}/${initial.modelSelection.modelId}`,
                thinking:
                  initial.modelSelection.thinkingLevel ??
                  (await modelDefault(
                    initial.modelSelection.provider,
                    initial.modelSelection.modelId,
                  )) ??
                  settings.thinking,
              }
            : !resumeId && selected
              ? {
                  ...settings,
                  thinking:
                    (await modelDefault(selected.provider, selected.id)) ?? settings.thinking,
                }
              : settings,
          model: selected ?? options.sessionOptions?.model,
          permissionMode: initial?.permissionMode,
          cwd,
          homeDir: options.homeDir,
          dataRoot: options.dataRoot,
          mcpPersistence: applicationMcpPersistence(vault),
          resumeId,
          resumeModelSelection,
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
                void changed().catch((error) => warning(String(error)));
                resolve(reply);
              };
              const cancel = () => settle("deny");
              pending.set(request.identity.epoch, { sessionId, request: payload, settle });
              void changed().catch((error) => warning(String(error)));
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
    const summaries = async (): Promise<WireSessionSummary[]> => {
      const committed = (
        await discoverSqliteSessions({
          dataRoot: options.dataRoot,
          homeDir: options.homeDir,
          onWarning: warning,
        })
      ).map((summary) => ({
        ...summary,
        running: sessions.get(summary.id)?.running ?? false,
        waitingPermission: [...pending.values()].some((item) => item.sessionId === summary.id),
      }));
      await localDatabase.reconcileSessions(committed);
      return committed;
    };
    const find = async (id: string, selection?: SessionOptions["resumeModelSelection"]) => {
      const current = sessions.get(id);
      if (current) return current;
      const summary = (await summaries()).find((s) => s.id === id);
      if (!summary) throw new CommandError("session_not_found");
      return open(summary.cwd, id, undefined, selection);
    };
    let active: WSContext | undefined;
    const subscriptions = new Map<unknown, Map<string, () => void>>();
    const send = (socket: WSContext, value: unknown) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(value));
    };
    const changed = (closedSessionId?: string): Promise<void> => {
      if (shuttingDown) return Promise.resolve();
      const work = (async () => {
        if (sharedConfiguration) registry.preferences = await database.preferences();
        const committed = await summaries();
        if (active && !shuttingDown)
          send(active, {
            type: "sessions_changed",
            ...(closedSessionId ? { closedSessionId } : {}),
            sessions: committed,
            projects: registry.projects,
            pinned: registry.pinned,
            preferences: registry.preferences,
          });
      })();
      changes.add(work);
      void work.finally(() => changes.delete(work)).catch(() => {});
      return work;
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
                    if (!shuttingDown)
                      void session.abort().catch((error) => warning(String(error)));
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
          const current = sessions.get(command.sessionId);
          if (current) {
            subscribe(socket, current);
            return { sessionId: current.id };
          }
          // Viewing persisted history must not recover tasks, acquire execution ownership,
          // or unlock credentials. Explicit execution commands open the Session later.
          const summary = (await summaries()).find((item) => item.id === command.sessionId);
          if (!summary) throw new CommandError("session_not_found");
          send(socket, {
            ...(await readSessionSnapshot({
              cwd: summary.cwd,
              homeDir: options.homeDir,
              dataRoot: options.dataRoot,
              id: summary.id,
            })),
            permissionMode: (await presentationSettings(summary.cwd)).permissionMode ?? "ask",
          });
          if (
            isSqliteSessionBusy({
              cwd: summary.cwd,
              homeDir: options.homeDir,
              dataRoot: options.dataRoot,
              id: summary.id,
            })
          )
            throw new CommandError("session_busy");
          await refreshModels();
          const spec = summary.model;
          const slash = spec.indexOf("/");
          const model =
            slash >= 0
              ? applicationModels.getModel(spec.slice(0, slash), spec.slice(slash + 1))
              : undefined;
          const modelUnavailable =
            !options.sessionOptions?.model &&
            (!model || !(await applicationModels.checkAuth(model.provider)));
          return { sessionId: summary.id, readonly: true, modelUnavailable };
        }
        case "tool_output.read": {
          const summary = (await summaries()).find((item) => item.id === command.sessionId);
          if (!summary) throw new CommandError("session_not_found");
          return readSessionToolOutput(
            {
              cwd: summary.cwd,
              homeDir: options.homeDir,
              dataRoot: options.dataRoot,
              id: summary.id,
            },
            command.outputRef,
            command.offset,
            command.maxBytes,
          );
        }
        case "session.unsubscribe":
          subscriptions.get(socket.raw)?.get(command.sessionId)?.();
          subscriptions.get(socket.raw)?.delete(command.sessionId);
          if (sessions.has(command.sessionId)) refreshIdle(sessions.get(command.sessionId)!);
          return {};
        case "prompt": {
          await refreshModels();
          const session = await find(command.sessionId);
          if (!options.sessionOptions?.models) {
            const slash = session.model.indexOf("/");
            const selected = applicationModels.getModel(
              session.model.slice(0, slash),
              session.model.slice(slash + 1),
            );
            if (!selected || !(await applicationModels.checkAuth(selected.provider)))
              throw new CommandError("model_unavailable");
            if (!session.running) await session.setModelSelection({ model: session.model });
          }
          subscribe(socket, session);
          state(socket, session);
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
          const settings = await presentationSettings(workspace);
          await refreshModels();
          return listModelCatalog(settings, options.sessionOptions?.models ?? applicationModels, {
            dataRoot: options.dataRoot,
          });
        }
        case "session.set_model": {
          await refreshModels();
          if (
            !options.sessionOptions?.models &&
            !applicationModels.getModel(command.provider, command.modelId)
          )
            throw new CommandError("model_unavailable");
          const thinkingLevel =
            command.thinkingLevel ?? (await modelDefault(command.provider, command.modelId));
          const session = await find(command.sessionId, {
            model: `${command.provider}/${command.modelId}`,
            thinkingLevel,
          });
          if (session.running) throw new CommandError("session_busy");
          const result = await session.setModelSelection({
            model: `${command.provider}/${command.modelId}`,
            thinkingLevel,
          });
          subscribe(socket, session);
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
          if (sharedConfiguration)
            registry.preferences = await database.updatePreferences(command.preferences);
          else {
            registry.preferences = { ...registry.preferences, ...command.preferences };
            await save();
          }
          await changed();
          return registry.preferences;
      }
    };
    const token = randomBytes(32).toString("hex");
    let port = 0;
    const app = new Hono();
    app.post("/private/model-services", async (c) => {
      const supplied = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
      const expected = options.managementToken ?? "";
      if (
        !expected ||
        c.req.header("origin") ||
        c.req.header("host") !== `127.0.0.1:${port}` ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        return c.text("Forbidden", 403);
      if (shuttingDown) return c.text("Closing", 503);
      const operation = (async () => {
        try {
          const input: unknown = await c.req.json();
          const List = Type.Object({ type: Type.Literal("list") }, { additionalProperties: false });
          const Delete = Type.Object(
            {
              type: Type.Literal("delete"),
              id: Type.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" }),
            },
            { additionalProperties: false },
          );
          const RevealKey = Type.Object(
            {
              type: Type.Literal("revealKey"),
              id: Type.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" }),
            },
            { additionalProperties: false },
          );
          const Save = Type.Object(
            {
              type: Type.Literal("save"),
              provider: ModelServiceSchema,
              credential: Type.Union([
                Type.Object({ type: Type.Literal("keep") }, { additionalProperties: false }),
                Type.Object({ type: Type.Literal("delete") }, { additionalProperties: false }),
                Type.Object(
                  { type: Type.Literal("replace"), ciphertext: Type.String({ minLength: 1 }) },
                  { additionalProperties: false },
                ),
              ]),
            },
            { additionalProperties: false },
          );
          const Templates = Type.Object(
            { type: Type.Literal("templates") },
            { additionalProperties: false },
          );
          const Test = Type.Object(
            {
              type: Type.Literal("test"),
              id: Type.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" }),
              modelId: Type.String({ minLength: 1, maxLength: 256 }),
            },
            { additionalProperties: false },
          );
          const Prices = Type.Object(
            { type: Type.Literal("prices"), ...ModelPriceRequestSchema.properties },
            { additionalProperties: false },
          );
          if (Value.Check(Prices, input)) return c.json(await lookupModelPrices(input));
          if (Value.Check(Templates, input)) return c.json(applicationModelTemplates());
          if (Value.Check(Test, input)) {
            const providers = await database.providers();
            const provider = providers.find((p) => p.id === input.id);
            const model = provider?.models.find((m) => m.id === input.modelId);
            if (!provider || !model) return c.json({ error: "unavailable-model" }, 409);
            const models =
              options.sessionOptions?.models ??
              createApplicationModels({
                providers: [{ ...provider, models: [{ ...model, enabled: true }] }],
                homeDir: options.homeDir,
                hasCredential: async (id) =>
                  (await database.credential(`provider:${id}`)) !== undefined,
                credential: (id) => vault.read(`provider:${id}`),
                capabilityStore: {
                  read: (key) => database.capability(key),
                  save: (key, value) => database.saveCapability(key, value),
                },
              });
            const selected = models.getModel(input.id, input.modelId);
            if (!selected) return c.json({ error: "unavailable-model" }, 409);
            const result = await models.completeSimple(
              selected,
              { messages: [{ role: "user", content: "Reply OK.", timestamp: Date.now() }] },
              {
                maxTokens: 8,
                signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(8000)]),
              },
            );
            if (result.stopReason === "error" || result.stopReason === "aborted")
              return c.json({ error: "connection-failed" }, 409);
            return c.json({});
          }
          if (Value.Check(RevealKey, input)) {
            const provider = (await database.providers()).find((item) => item.id === input.id);
            if (!provider) return c.json({ error: "unavailable-provider" }, 409);
            return c.json({ value: (await vault.read(`provider:${input.id}`)) ?? null });
          }
          if (Value.Check(List, input)) return c.json(await database.providers());
          if (Value.Check(Delete, input)) {
            await database.deleteProvider(input.id);
            return c.json({});
          }
          if (Value.Check(Save, input)) {
            await database.saveProvider(input.provider, input.credential);
            return c.json({});
          }
          return c.json({ error: "invalid-operation" }, 400);
        } catch {
          return c.json({ error: "model-service-operation-failed" }, 409);
        }
      })();
      commands.add(operation);
      try {
        return await operation;
      } finally {
        commands.delete(operation);
      }
    });
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
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: app.fetch,
      websocket,
      maxRequestBodySize: 1024 * 1024,
    });
    closeListener = () => server.stop(true);
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
          await releaseResource(async () => {
            await Promise.all(changes);
          });
          if (localDatabase !== database) await releaseResource(() => localDatabase.close());
          await releaseResource(() => database.close());
          await releaseResource(() => server.stop(true));
          if (failure !== undefined) throw failure;
        })()),
    };
  } catch (error) {
    await closeListener?.();
    if (localDatabase !== database) await localDatabase.close();
    await database.close();
    throw error;
  }
}
