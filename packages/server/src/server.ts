import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, stat, realpath, lstat, rmdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "@hono/bun";
import type { WSContext } from "hono/ws";
import { Context, Effect, FiberMap, Layer, ManagedRuntime } from "effect";
import {
  createSession,
  createApplicationModels,
  listSessions,
  renameSessionTitle,
  deleteSession,
  moveSession,
  withSessionMove,
  discoverSqliteSessions,
  isSqliteSessionBusy,
  readSessionSnapshot,
  readSessionToolOutput,
  listModelCatalog,
  listSkills,
  loadSettings,
  type Session,
  type SessionOptions,
} from "@rukie/agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  type WireCommand,
  type WireInteractionRequest,
  type WirePermissionReply,
  type WireQuestionReply,
  type WirePlanReviewReply,
  type WireErrorCode,
  type WireResponse,
  type WireProject,
  type WireSessionSummary,
  type WireWorktree,
  WIRE_SUBPROTOCOL,
  isWireUserVisibleErrorCode,
  ModelServiceSchema,
  ModelPriceRequestSchema,
  parseModelServiceSave,
} from "@rukie/shared";
import { executeHost, hostOperation, HostError, type HostExecutor } from "./host.ts";
import { lookupModelPrices } from "./model-prices.ts";
import { parseWireCommand } from "./command.ts";
import { AppDatabase, type ApplicationRegistry } from "./storage/app-database.ts";
import { secretVault, type SecretEncryption, type EncryptionBackend } from "./storage/secrets.ts";
import { applicationMcpPersistence, applicationConfiguration } from "./storage/configuration.ts";

import {
  projectGit,
  checkoutBranch,
  BranchFailure,
  createWorktree,
  discardUnopenedWorktree,
  worktreeDirectoryExists,
  removeWorktree,
  pruneWorktrees,
} from "./worktrees.ts";

type Registry = ApplicationRegistry;
export interface ServerOptions {
  hostPlatform?: NodeJS.Platform;
  executeHost?: HostExecutor;
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
  constructor(
    readonly code: WireErrorCode,
    readonly params?: Record<string, string | number>,
  ) {
    super(code);
  }
}
function publicWireError(error: unknown) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    typeof error.code !== "string" ||
    !isWireUserVisibleErrorCode(error.code)
  )
    return undefined;
  const code = error.code;
  const value = "params" in error ? error.params : undefined;
  const params: Record<string, string | number> = {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== "string" && typeof item !== "number") return { code };
      params[key] = item;
    }
    return { code, params };
  }
  return { code };
}
class ModelServiceFailure extends CommandError {
  constructor(
    readonly privateError: "unavailable-model" | "unavailable-provider" | "connection-failed",
  ) {
    super(privateError === "connection-failed" ? "internal" : "model_unavailable");
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
  // Resolve initial OS aliases once, then pin every owned ancestor's filesystem identity.
  const ownedWorkspace = await realpath(workspace);
  const ownedAncestry: { path: string; dev: number; ino: number }[] = [];
  for (let path = ownedWorkspace; ; path = dirname(path)) {
    const info = await lstat(path);
    ownedAncestry.push({ path, dev: info.dev, ino: info.ino });
    if (dirname(path) === path) break;
  }
  const workspaceIdentityUnchanged = async () => {
    for (const identity of ownedAncestry) {
      const info = await lstat(identity.path);
      if (info.isSymbolicLink() || info.dev !== identity.dev || info.ino !== identity.ino)
        return false;
    }
    return (await realpath(workspace)) === ownedWorkspace;
  };
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
    // Preserve legacy registry spelling; filesystem identity is used for directory conflicts.
    const presentationHomeDir = await realpath(options.homeDir).catch(() => options.homeDir);
    const directoryIdentity = (path: string) => realpath(path).catch(() => path);
    const projectSnapshot = () =>
      registry.projects.map((project) => ({ ...project, directories: [...project.directories] }));
    const projectIdentities = (projects = projectSnapshot()) =>
      Promise.all(
        projects.map(async (project) => ({
          project,
          primary: await directoryIdentity(project.primary),
          directories: await Promise.all(project.directories.map(directoryIdentity)),
        })),
      );
    const removingProjects = new Set<string>();
    const projectOpening = async (cwd: string, projectId?: string) => {
      const identity = await directoryIdentity(cwd);
      const identities = await projectIdentities();
      const owningProject = identities.find((item) => item.project.id === projectId);
      const trustedDirectories = [
        ...new Set([
          ...(owningProject?.project.trusted
            ? [...owningProject.project.directories, ...owningProject.directories]
            : []),
          // Core matches exact cwd spellings; add its alias only for this trusted filesystem owner.
          ...(owningProject?.project.trusted ? [cwd] : []),
        ]),
      ].sort();
      return {
        identity,
        owningProject: owningProject && {
          ...owningProject,
          project: {
            ...owningProject.project,
            directories: [...owningProject.project.directories],
          },
        },
        trustedDirectories,
        key: JSON.stringify({
          projectId: owningProject?.project.id,
          primary: owningProject?.primary,
          directories: owningProject?.project.directories ?? [],
          trustedDirectories,
        }),
      };
    };

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
    const ModelOperation = Type.Union([List, Delete, RevealKey, Save, Test, Prices]);
    const modelOperation = async (
      input: import("typebox").Static<typeof ModelOperation>,
      signal: AbortSignal,
    ) => {
      if (Value.Check(Prices, input)) return await lookupModelPrices(input);
      if (Value.Check(Test, input)) {
        const providers = await database.providers();
        const provider = providers.find((p) => p.id === input.id);
        const model = provider?.models.find((m) => m.id === input.modelId);
        if (!provider || !model) throw new ModelServiceFailure("unavailable-model");
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
        if (!selected) throw new ModelServiceFailure("unavailable-model");
        const result = await models.completeSimple(
          selected,
          { messages: [{ role: "user", content: "Reply OK.", timestamp: Date.now() }] },
          {
            maxTokens: 8,
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          },
        );
        if (result.stopReason === "error" || result.stopReason === "aborted")
          throw new ModelServiceFailure("connection-failed");
        return {};
      }
      if (Value.Check(RevealKey, input)) {
        const provider = (await database.providers()).find((item) => item.id === input.id);
        if (!provider) throw new ModelServiceFailure("unavailable-provider");
        return { value: (await vault.read(`provider:${input.id}`)) ?? null };
      }
      if (Value.Check(List, input)) return await database.providers();
      if (Value.Check(Delete, input)) {
        await database.deleteProvider(input.id);
        return {};
      }
      if (Value.Check(Save, input)) {
        await database.saveProvider(input.provider, input.credential);
        return {};
      }
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
    // Keep canonical ownership checks and all Project writes in one queue through persistence.
    let projectMutationTail: Promise<unknown> = Promise.resolve();
    const mutateProjects = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = projectMutationTail.then(operation);
      projectMutationTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const validateDirectories = async (inputs: string[]) => {
      const directories: string[] = [];
      for (const input of inputs) {
        if (!isAbsolute(input) || !(await stat(input).catch(() => undefined))?.isDirectory())
          throw new CommandError("project_not_found");
        const path = await realpath(input);
        if (!directories.includes(path)) directories.push(path);
      }
      const root = await realpath(directory);
      if (
        directories.some((path) => {
          const child = relative(root, path);
          return (
            child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
          );
        })
      )
        throw new CommandError("project_reserved");
      return directories;
    };
    const sessions = new Map<string, Session>();
    const openedProjects = new Map<string, { cwd: string; identity: string; key: string }>();
    const pending = new Map<
      string,
      {
        sessionId: string;
        request: WireInteractionRequest;
        settle: (command: Extract<WireCommand, { type: "interaction.reply" }>) => void;
      }
    >();
    const interaction = <Reply>(
      sessionId: string,
      request: WireInteractionRequest,
      signal: AbortSignal,
      fallback: Reply,
      readReply: (
        command: Extract<WireCommand, { type: "interaction.reply" }>,
      ) => Reply | undefined,
    ): Promise<Reply> =>
      new Promise((resolve) => {
        const settle = (reply: Reply) => {
          if (!pending.delete(request.identity.epoch)) return;
          signal.removeEventListener("abort", cancel);
          if (active)
            send(active, { type: "interaction_settled", sessionId, identity: request.identity });
          void changed().catch((error) => warning(String(error)));
          resolve(reply);
        };
        const cancel = () => settle(fallback);
        pending.set(request.identity.epoch, {
          sessionId,
          request,
          settle: (command) => {
            const reply = readReply(command);
            if (reply === undefined) throw new CommandError("interaction_kind_mismatch");
            settle(reply);
          },
        });
        void changed().catch((error) => warning(String(error)));
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
        else if (active)
          send(active, {
            type: "interaction_requested",
            sessionId,
            identity: request.identity,
            request,
          });
      });
    const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const observations = new Map<string, () => void>();
    const children = new Map<string, boolean>();
    const admissions = new Map<string, number>();
    const sessionCommands = new Map<string, number>();
    const organizing = new Set<string>();
    const retirements = new Set<Promise<void>>();
    const commands = new Set<Promise<unknown>>();
    const changes = new Set<Promise<void>>();
    let shuttingDown = false;
    // Execution blocks organization changes; a passive subscriber does not.
    const executing = (session: Session) =>
      (admissions.get(session.id) ?? 0) > 0 ||
      session.running ||
      session.queuedInputs.length ||
      children.get(session.id) ||
      session.jobs().some((job) => job.status === "running" || job.status === "stopping") ||
      [...pending.values()].some((item) => item.sessionId === session.id);
    const held = (session: Session) =>
      executing(session) ||
      organizing.has(session.id) ||
      (sessionCommands.get(session.id) ?? 0) > 0 ||
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
            openedProjects.delete(session.id);
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
      if (resumeId && organizing.has(resumeId))
        return Promise.reject(new CommandError("session_busy"));
      const current = resumeId ? sessions.get(resumeId) : undefined;
      if (current) return Promise.resolve(current);
      const key = resumeId ?? crypto.randomUUID();
      const existing = openings.get(key);
      if (existing) return existing;
      let owner: Session | undefined;
      let openedProject: { identity: string; key: string } | undefined;
      const opening = (async () => {
        let binding = resumeId ? await localDatabase.sessionBinding(resumeId) : undefined;
        const projectId = binding?.projectId ?? initial?.project ?? undefined;
        if (projectId && removingProjects.has(projectId)) throw new CommandError("session_busy");
        const project = registry.projects.find((item) => item.id === projectId);
        if (resumeId && project && binding?.worktreeId) {
          const worktree = (await localDatabase.worktrees()).find(
            (item) => item.id === binding?.worktreeId,
          );
          // A retained record plus a missing path is durable evidence of interrupted deletion.
          // Repair before native Resume, including failures after Git removal or after Move commit.
          if (!worktree || !(await worktreeDirectoryExists(worktree.path))) {
            await withSessionMove(
              {
                cwd,
                homeDir: options.homeDir,
                dataRoot: options.dataRoot,
                id: resumeId,
                newCwd: project.primary,
              },
              async (move) => {
                if (cwd !== project.primary) await move();
                await localDatabase.bindSession(resumeId, project.id);
              },
            );
            binding = { projectId: project.id, worktreeId: null };
            cwd = project.primary;
          }
        }
        if (resumeId && project && !binding?.worktreeId && cwd !== project.primary) {
          await moveSession({
            cwd,
            homeDir: options.homeDir,
            dataRoot: options.dataRoot,
            id: resumeId,
            newCwd: project.primary,
          });
          cwd = project.primary;
        }
        const openingState = await projectOpening(cwd, projectId);
        const { owningProject, identity: cwdIdentity } = openingState;
        openedProject = openingState;
        const configuredSettings =
          options.sessionOptions?.settings ?? (await configuration.settings());
        const userSettings = {
          ...configuredSettings,
          trustedProjects: [
            ...new Set([
              ...(configuredSettings.trustedProjects ?? []),
              ...openingState.trustedDirectories,
            ]),
          ],
        };
        const settings = (
          await loadSettings({
            cwd,
            homeDir: options.homeDir,
            dataRoot: options.dataRoot,
            userSettings,
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
          additionalDirectories: owningProject?.project.directories.filter(
            (_, index) =>
              owningProject.directories[index] !==
              (binding?.worktreeId || initial?.worktree ? owningProject.primary : cwdIdentity),
          ),
          homeDir: options.homeDir,
          dataRoot: options.dataRoot,
          mcpPersistence: applicationMcpPersistence(vault),
          resumeId,
          resumeModelSelection,
          onWarning: warning,
          onPermissionAsk: ({ signal, ...request }) =>
            interaction<WirePermissionReply>(
              owner?.id ?? resumeId ?? "",
              { ...request, kind: "permission" },
              signal,
              "deny",
              (command) => (command.kind === "permission" ? command.reply : undefined),
            ),
          onQuestion: ({ signal, ...request }) =>
            interaction<WireQuestionReply>(
              owner?.id ?? resumeId ?? "",
              { ...request, kind: "question" },
              signal,
              "declined",
              (command) => (command.kind === "question" ? command.reply : undefined),
            ),
          onPlanReview: ({ signal, ...request }) =>
            interaction<WirePlanReviewReply>(
              owner?.id ?? resumeId ?? "",
              { ...request, kind: "plan_review" },
              signal,
              { kind: "takeover" },
              (command) => (command.kind === "plan_review" ? command.reply : undefined),
            ),
        });
      })()
        .then(async (session) => {
          owner = session;
          if (initial?.planMode !== undefined) {
            try {
              await session.setPlanMode(initial.planMode);
            } catch (error) {
              await session.close();
              throw error;
            }
          }
          sessions.set(session.id, session);
          // The opening state is captured before createSession starts configuration loading.
          openedProjects.set(session.id, { cwd, ...openedProject! });
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
      const committed = await discoverSqliteSessions({
        dataRoot: options.dataRoot,
        homeDir: options.homeDir,
        onWarning: warning,
      });
      const worktrees = await localDatabase.worktrees();
      const projected = await Promise.all(
        committed.map(async (summary) => {
          const binding = await localDatabase.sessionBinding(summary.id);
          const worktree = worktrees.find((item) => item.id === binding?.worktreeId);
          return {
            ...summary,
            worktree: worktree ? { id: worktree.id, branch: worktree.branch } : null,
            projectId: binding?.projectId ?? null,
            running: sessions.get(summary.id)?.running ?? false,
            waitingInteraction: [...pending.values()].some((item) => item.sessionId === summary.id),
          };
        }),
      );
      await localDatabase.reconcileSessions(projected);
      return projected;
    };
    const find = async (id: string, selection?: SessionOptions["resumeModelSelection"]) => {
      const current = sessions.get(id);
      if (current) {
        const opened = openedProjects.get(id);
        const binding = await localDatabase.sessionBinding(id);
        const latest = await projectOpening(opened?.cwd ?? "", binding?.projectId);
        if (opened?.key === latest.key || executing(current)) return current;
        // Applying Project ownership, directories and trust waits for idle execution.
        // Closing here reloads cwd configuration without interrupting an active Run.
        await current.close();
        if (sessions.get(id) === current) {
          clearTimeout(idleTimers.get(id));
          idleTimers.delete(id);
          observations.get(id)?.();
          observations.delete(id);
          sessions.delete(id);
          children.delete(id);
          openedProjects.delete(id);
          for (const subscribed of subscriptions.values()) {
            subscribed.get(id)?.();
            subscribed.delete(id);
          }
        }
      }
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
        let projects = projectSnapshot();
        let committed = await summaries();
        // Discovery is asynchronous; publish summaries with the current Project registry.
        while (JSON.stringify(projects) !== JSON.stringify(registry.projects)) {
          projects = projectSnapshot();
          committed = await summaries();
        }
        if (active && !shuttingDown)
          send(active, {
            type: "sessions_changed",
            homeDir: presentationHomeDir,
            ...(closedSessionId ? { closedSessionId } : {}),
            sessions: committed,
            projects,
            pinned: registry.pinned,
            archived: registry.archived,
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
    const startRequest = async <Result extends { requestId?: string }>(
      session: Session,
      accept: () => Promise<Result>,
    ): Promise<Result> => {
      admissions.set(session.id, (admissions.get(session.id) ?? 0) + 1);
      refreshIdle(session);
      try {
        const accepted = await accept();
        const { requestId } = accepted;
        if (!requestId) return accepted;
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
        return accepted;
      } finally {
        admissions.set(session.id, (admissions.get(session.id) ?? 1) - 1);
        refreshIdle(session);
      }
    };
    const executeCommand = async (command: WireCommand, socket: WSContext): Promise<unknown> => {
      if (shuttingDown) throw new CommandError("internal");
      if (command.type.startsWith("modelServices.")) {
        if ((options.encryptionBackend ?? "electron") === "electron")
          throw new CommandError("model_services_unavailable");
        try {
          switch (command.type) {
            case "modelServices.save": {
              if (
                !parseModelServiceSave({
                  provider: command.provider,
                  credential: command.credential,
                })
              )
                throw new CommandError("invalid_command");
              let credential: import("typebox").Static<typeof Save>["credential"] = {
                type: "keep",
              };
              if (command.credential.type === "replace") {
                if (!options.encryption) throw new CommandError("internal");
                credential = {
                  type: "replace",
                  ciphertext: await options.encryption.encrypt(
                    `provider:${command.provider.id}`,
                    command.credential.value,
                  ),
                };
              } else credential = command.credential;
              return await modelOperation(
                { type: "save", provider: command.provider, credential },
                AbortSignal.timeout(8000),
              );
            }
            case "modelServices.list":
              return await modelOperation({ type: "list" }, AbortSignal.timeout(8000));
            case "modelServices.prices":
              return await modelOperation(
                { type: "prices", baseUrl: command.baseUrl, modelId: command.modelId },
                AbortSignal.timeout(8000),
              );
            case "modelServices.delete":
              return await modelOperation(
                { type: "delete", id: command.providerId },
                AbortSignal.timeout(8000),
              );
            case "modelServices.revealKey":
              return await modelOperation(
                { type: "revealKey", id: command.providerId },
                AbortSignal.timeout(8000),
              );
            case "modelServices.test":
              return await modelOperation(
                { type: "test", id: command.providerId, modelId: command.modelId },
                AbortSignal.timeout(8000),
              );
          }
        } catch (error) {
          // Never propagate provider, vault or encryption exceptions containing credentials.
          throw new CommandError(error instanceof CommandError ? error.code : "internal");
        }
      }
      switch (command.type) {
        case "host.pickFolder":
        case "host.revealPath":
        case "host.openInTerminal":
          return hostOperation(command, {
            platform: options.hostPlatform ?? process.platform,
            execute: options.executeHost ?? executeHost,
            roots: [
              ...registry.projects.flatMap((project) => project.directories),
              workspace,
              ...(await localDatabase.worktrees()).map((item) => item.path),
            ],
          });
        case "worktrees.list": {
          const items = await localDatabase.worktrees();
          const existing = await Promise.all(
            items.map(async (item) => ((await worktreeDirectoryExists(item.path)) ? item : null)),
          );
          return existing.filter((item) => item !== null);
        }
        case "worktrees.refresh":
        case "worktree.delete": {
          return mutateProjects(async () => {
            const items = await localDatabase.worktrees();
            const selected =
              command.type === "worktree.delete"
                ? items.filter((item) => item.id === command.worktreeId)
                : items;
            if (command.type === "worktree.delete" && selected.length === 0)
              throw new CommandError("invalid_command");
            const invalid: WireWorktree[] = [];
            for (const item of selected) {
              if (command.type === "worktree.delete" || !(await worktreeDirectoryExists(item.path)))
                invalid.push(item);
            }
            const bound: WireSessionSummary[] = [];
            try {
              for (const summary of await summaries()) {
                const binding = await localDatabase.sessionBinding(summary.id);
                if (!invalid.some((item) => item.id === binding?.worktreeId)) continue;
                const current = sessions.get(summary.id);
                if (
                  organizing.has(summary.id) ||
                  (sessionCommands.get(summary.id) ?? 0) > 0 ||
                  openings.has(summary.id) ||
                  (current && executing(current)) ||
                  (!current &&
                    isSqliteSessionBusy({
                      cwd: summary.cwd,
                      homeDir: options.homeDir,
                      dataRoot: options.dataRoot,
                      id: summary.id,
                    }))
                )
                  throw new CommandError("session_busy");
                organizing.add(summary.id);
                bound.push(summary);
              }
              for (const summary of bound) {
                const current = sessions.get(summary.id);
                if (!current) continue;
                clearTimeout(idleTimers.get(summary.id));
                idleTimers.delete(summary.id);
                await current.close();
                observations.get(summary.id)?.();
                observations.delete(summary.id);
                sessions.delete(summary.id);
                openedProjects.delete(summary.id);
                children.delete(summary.id);
                admissions.delete(summary.id);
                for (const subscribed of subscriptions.values()) {
                  subscribed.get(summary.id)?.();
                  subscribed.delete(summary.id);
                }
              }
              // Nest reservations so every bound Session stays exclusively owned through Git,
              // metadata Move and binding publication, including another frontend's Core opens.
              const remove = async () => {
                if (command.type === "worktree.delete") {
                  try {
                    await removeWorktree(invalid[0]!);
                  } catch (error) {
                    throw new CommandError("worktree_failed", {
                      message: error instanceof Error ? error.message : String(error),
                    });
                  }
                } else {
                  for (const repository of new Set(selected.map((item) => item.repository)))
                    await pruneWorktrees(repository);
                }
              };
              const reserve = async (index: number): Promise<void> => {
                const summary = bound[index];
                if (!summary) return remove();
                const project = registry.projects.find((item) => item.id === summary.projectId);
                if (!project) throw new CommandError("project_not_found");
                await withSessionMove(
                  {
                    cwd: summary.cwd,
                    homeDir: options.homeDir,
                    dataRoot: options.dataRoot,
                    id: summary.id,
                    newCwd: project.primary,
                  },
                  async (move) => {
                    await reserve(index + 1);
                    if (command.type === "worktree.delete") await move();
                    await localDatabase.bindSession(summary.id, project.id);
                  },
                );
              };
              await reserve(0);
              for (const item of invalid) await localDatabase.removeWorktree(item.id);
              await changed();
              const remaining = await localDatabase.worktrees();
              const existing = await Promise.all(
                remaining.map(async (item) =>
                  (await worktreeDirectoryExists(item.path)) ? item : null,
                ),
              );
              return existing.filter((item) => item !== null);
            } finally {
              for (const summary of bound) organizing.delete(summary.id);
            }
          });
        }
        case "project.git": {
          const project = registry.projects.find((item) => item.id === command.projectId);
          if (!project) throw new CommandError("project_not_found");
          return projectGit(project.primary);
        }
        case "project.checkout":
        case "project.createBranch": {
          return mutateProjects(async () => {
            const project = registry.projects.find((item) => item.id === command.projectId);
            if (!project) throw new CommandError("project_not_found");
            // Sessions working in the primary folder would observe the checkout; worktrees would not.
            const bound: WireSessionSummary[] = [];
            try {
              for (const summary of await summaries()) {
                if (summary.projectId !== project.id || summary.worktree) continue;
                const current = sessions.get(summary.id);
                if (
                  organizing.has(summary.id) ||
                  (sessionCommands.get(summary.id) ?? 0) > 0 ||
                  openings.has(summary.id) ||
                  (current && executing(current)) ||
                  (!current &&
                    isSqliteSessionBusy({
                      cwd: summary.cwd,
                      homeDir: options.homeDir,
                      dataRoot: options.dataRoot,
                      id: summary.id,
                    }))
                )
                  throw new CommandError("session_busy");
                bound.push(summary);
                organizing.add(summary.id);
              }
              const result = await checkoutBranch(
                project.primary,
                command.branch,
                command.type === "project.createBranch",
              ).catch((error: unknown) => {
                if (error instanceof BranchFailure)
                  throw new CommandError(
                    error.code,
                    error.code === "git_failed"
                      ? { message: error.message }
                      : { branch: command.branch },
                  );
                throw error;
              });
              await changed();
              return result;
            } finally {
              for (const summary of bound) organizing.delete(summary.id);
            }
          });
        }
        case "projects.list":
          return runtime.runPromise(
            Effect.gen(function* () {
              return (yield* DesktopRegistry).value.projects;
            }),
          );
        case "project.create": {
          const name = command.name.trim();
          if (!name || name.length > 128) throw new CommandError("invalid_command");
          const directories = await validateDirectories(command.directories);
          return mutateProjects(async () => {
            const primary = directories[0]!;
            const identities = await projectIdentities();
            const existing = identities.find((item) => item.primary === primary);
            if (existing) return existing.project;
            const conflict = identities.find((item) =>
              item.directories.some((path) => directories.includes(path)),
            );
            if (conflict)
              throw new CommandError("project_conflict", { project: conflict.project.name });
            const project: WireProject = {
              id: crypto.randomUUID(),
              name,
              directories,
              primary,
              trusted: true,
            };
            registry.projects.push(project);
            await save();
            await changed();
            return project;
          });
        }
        case "project.update": {
          return mutateProjects(async () => {
            const project = registry.projects.find((p) => p.id === command.projectId);
            if (!project) throw new CommandError("project_not_found");
            const name = command.name.trim();
            if (!name || name.length > 128) throw new CommandError("invalid_command");
            const directories = await validateDirectories(command.directories);
            if (!isAbsolute(command.primary)) throw new CommandError("invalid_command");
            const primary = await directoryIdentity(command.primary);
            if (!directories.includes(primary)) throw new CommandError("invalid_command");
            const identities = await projectIdentities();
            const conflict = identities.find(
              (item) =>
                item.project.id !== project.id &&
                item.directories.some((path) => directories.includes(path)),
            );
            if (conflict)
              throw new CommandError("project_conflict", { project: conflict.project.name });
            // The Project remains present throughout this serialized mutation.
            const previous = identities.find((item) => item.project.id === project.id)!;
            if (
              project.trusted &&
              directories.some((path) => !previous.directories.includes(path)) &&
              command.trusted !== true
            )
              throw new CommandError("project_trust_required");
            Object.assign(project, { name, directories, primary });
            await save();
            await changed();
            return project;
          });
        }
        case "project.remove": {
          return mutateProjects(async () => {
            const project = registry.projects.find((p) => p.id === command.projectId);
            if (!project) throw new CommandError("project_not_found");
            removingProjects.add(project.id);
            const bound: WireSessionSummary[] = [];
            try {
              for (const summary of await summaries()) {
                if (summary.projectId !== project.id) continue;
                const current = sessions.get(summary.id);
                if (
                  organizing.has(summary.id) ||
                  (sessionCommands.get(summary.id) ?? 0) > 0 ||
                  openings.has(summary.id) ||
                  (current && executing(current)) ||
                  (!current &&
                    isSqliteSessionBusy({
                      cwd: summary.cwd,
                      homeDir: options.homeDir,
                      dataRoot: options.dataRoot,
                      id: summary.id,
                    }))
                )
                  throw new CommandError("session_busy");
                bound.push(summary);
                organizing.add(summary.id);
              }
              for (const summary of bound)
                await executeCommand(
                  { type: "session.delete", id: command.id, sessionId: summary.id },
                  socket,
                );
              registry.projects = registry.projects.filter((p) => p.id !== project.id);
              await save();
              await changed();
              return {};
            } finally {
              removingProjects.delete(project.id);
              for (const summary of bound) organizing.delete(summary.id);
            }
          });
        }
        case "project.trust": {
          return mutateProjects(async () => {
            const project = registry.projects.find((p) => p.id === command.projectId);
            if (!project) throw new CommandError("project_not_found");
            project.trusted = true;
            await save();
            await changed();
            return project;
          });
        }
        case "sessions.list":
          return summaries();
        case "session.create": {
          return mutateProjects(async () => {
            const primary =
              command.project === null
                ? join(workspace, crypto.randomUUID())
                : registry.projects.find((p) => p.id === command.project)?.primary;
            if (!primary) throw new CommandError("project_not_found");
            let cwd: string = primary;
            if (command.worktree && command.project === null)
              throw new CommandError("invalid_command");
            let worktree: WireWorktree | undefined;
            if (command.worktree && command.project) {
              try {
                worktree = await createWorktree(directory, command.project, cwd);
                await localDatabase.saveWorktree(worktree);
                cwd = worktree.path;
              } catch (error) {
                if (worktree)
                  await discardUnopenedWorktree(worktree).catch((cleanup) =>
                    warning(String(cleanup)),
                  );
                throw new CommandError("worktree_failed", {
                  message: String(error instanceof Error ? error.message : error),
                });
              }
            }
            if (command.project === null) await mkdir(cwd);
            let session: Session;
            try {
              session = await runtime.runPromise(
                Effect.gen(function* () {
                  const core = yield* AgentCore;
                  return yield* Effect.promise(() => core.open(cwd, undefined, command));
                }),
              );
            } catch (error) {
              if (worktree) {
                await discardUnopenedWorktree(worktree).catch((cleanup) =>
                  warning(String(cleanup)),
                );
                await localDatabase.removeWorktree(worktree.id);
              }
              if (command.project === null)
                await rmdir(cwd).catch((cleanupError: unknown) =>
                  warning(
                    `Could not remove unopened conversation workspace: ${String(cleanupError)}`,
                  ),
                );
              throw error;
            }
            if (command.project !== null)
              await localDatabase.bindSession(session.id, command.project, worktree?.id);
            subscribe(socket, session);
            const { requestId } = await startRequest(session, async () =>
              command.goal
                ? session.createGoal(command.text, { images: command.images })
                : { requestId: await session.followUp(command.text, { images: command.images }) },
            );
            await changed();
            return { sessionId: session.id, requestId };
          });
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
        case "prompt":
        case "session.goal_create":
        case "session.goal_resume": {
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
          return startRequest(session, async () => {
            if (command.type === "session.goal_resume") return session.resumeGoal();
            if (command.type === "session.goal_create")
              return session.createGoal(command.text, { images: command.images });
            return { requestId: await session.followUp(command.text, { images: command.images }) };
          });
        }
        case "session.goal_pause": {
          const session = await find(command.sessionId);
          subscribe(socket, session);
          return session.pauseGoal();
        }
        case "session.goal_clear": {
          const session = await find(command.sessionId);
          subscribe(socket, session);
          await session.clearGoal();
          return {};
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
          if (item.request.kind !== command.kind)
            throw new CommandError("interaction_kind_mismatch");
          if (
            item.request.kind === "question" &&
            command.kind === "question" &&
            command.reply !== "declined"
          ) {
            const { questions } = item.request;
            if (
              command.reply.answers.length !== questions.length ||
              command.reply.answers.some((answer, index) => {
                const question = questions[index]!;
                return (
                  (!question.multiSelect && answer.selected.length > 1) ||
                  answer.selected.some(
                    (label) => !question.options.some((option) => option.label === label),
                  )
                );
              })
            )
              throw new CommandError("interaction_invalid_reply");
          }
          item.settle(command);
          return {};
        }
        case "skills.list": {
          if (command.projectId && command.sessionId) throw new CommandError("invalid_command");
          let cwd: string | undefined;
          if (command.sessionId) {
            const summary = (await summaries()).find((item) => item.id === command.sessionId);
            if (!summary) throw new CommandError("session_not_found");
            cwd = summary.cwd;
          } else if (command.projectId) {
            cwd = registry.projects.find((item) => item.id === command.projectId)?.primary;
            if (!cwd) throw new CommandError("project_not_found");
          }
          return listSkills({
            homeDir: options.homeDir,
            dataRoot: options.configurationRoot ?? directory,
            cwd,
          });
        }
        case "models.list": {
          const settings = await presentationSettings(workspace);
          await refreshModels();
          return listModelCatalog(settings, options.sessionOptions?.models ?? applicationModels, {
            dataRoot: options.dataRoot,
            providers: await database.providers(),
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
        case "session.set_plan_mode": {
          const session = await find(command.sessionId);
          await session.setPlanMode(command.on);
          return {};
        }
        case "session.set_permission_mode": {
          const session = await find(command.sessionId);
          session.setPermissionMode(command.mode);
          state(socket, session);
          await changed();
          return { mode: command.mode };
        }
        case "session.move": {
          return mutateProjects(async () => {
            const project = registry.projects.find((item) => item.id === command.projectId);
            if (command.projectId !== null && !project) throw new CommandError("project_not_found");
            if (project && removingProjects.has(project.id)) throw new CommandError("session_busy");
            const summary = (await summaries()).find((item) => item.id === command.sessionId);
            if (!summary) throw new CommandError("session_not_found");
            if (summary.worktree) throw new CommandError("worktree_session");
            if (summary.projectId === command.projectId) throw new CommandError("invalid_command");
            const current = sessions.get(command.sessionId);
            if (
              openings.has(command.sessionId) ||
              (current && executing(current)) ||
              [...pending.values()].some((item) => item.sessionId === command.sessionId)
            )
              throw new CommandError("session_busy");
            if (current) {
              clearTimeout(idleTimers.get(current.id));
              idleTimers.delete(current.id);
              await current.close();
              observations.get(current.id)?.();
              observations.delete(current.id);
              sessions.delete(current.id);
              openedProjects.delete(current.id);
              children.delete(current.id);
              admissions.delete(current.id);
              for (const subscribed of subscriptions.values()) {
                subscribed.get(current.id)?.();
                subscribed.delete(current.id);
              }
            }
            const newCwd = project?.primary ?? join(workspace, crypto.randomUUID());
            if (!project) await mkdir(newCwd);
            try {
              await moveSession({
                cwd: summary.cwd,
                homeDir: options.homeDir,
                dataRoot: options.dataRoot,
                id: summary.id,
                newCwd,
              });
            } catch (error) {
              if (!project) {
                try {
                  await rm(newCwd, { recursive: true });
                } catch (cleanupError) {
                  warning(
                    `Could not remove unused conversation workspace: ${String(cleanupError)}`,
                  );
                }
              }
              throw error;
            }
            if (project) await localDatabase.bindSession(summary.id, project.id);
            else await localDatabase.unbindSession(summary.id);
            await changed();
            return {};
          });
        }
        case "session.delete": {
          const summary = (await summaries()).find((session) => session.id === command.sessionId);
          if (!summary) throw new CommandError("session_not_found");
          const current = sessions.get(command.sessionId);
          if (
            openings.has(command.sessionId) ||
            (current && executing(current)) ||
            [...pending.values()].some((item) => item.sessionId === command.sessionId)
          )
            throw new CommandError("session_busy");
          if (current) {
            clearTimeout(idleTimers.get(current.id));
            idleTimers.delete(current.id);
            await current.close();
            observations.get(current.id)?.();
            observations.delete(current.id);
            sessions.delete(current.id);
            openedProjects.delete(current.id);
            children.delete(current.id);
            admissions.delete(current.id);
            for (const subscribed of subscriptions.values()) {
              subscribed.get(current.id)?.();
              subscribed.delete(current.id);
            }
          }
          await deleteSession({
            cwd: summary.cwd,
            homeDir: options.homeDir,
            dataRoot: options.dataRoot,
            id: summary.id,
          });
          await localDatabase.unbindSession(summary.id);
          // Only app-owned direct children qualify. Never follow a replaced workspace or cwd link.
          const child = relative(workspace, summary.cwd);
          if (
            summary.projectId === null &&
            child &&
            child !== ".." &&
            !isAbsolute(child) &&
            !child.includes(sep)
          ) {
            try {
              const [rootInfo, childInfo] = await Promise.all([
                lstat(workspace),
                lstat(summary.cwd),
              ]);
              if (
                !rootInfo.isSymbolicLink() &&
                !childInfo.isSymbolicLink() &&
                childInfo.isDirectory()
              ) {
                const root = await realpath(workspace);
                const target = await realpath(summary.cwd);
                if (
                  root === ownedWorkspace &&
                  relative(root, target) === child &&
                  (await workspaceIdentityUnchanged())
                )
                  await rm(summary.cwd, { recursive: true });
              }
            } catch (error) {
              warning(`Could not remove conversation workspace: ${String(error)}`);
            }
          }
          registry.pinned = registry.pinned.filter((id) => id !== command.sessionId);
          registry.archived = registry.archived.filter((id) => id !== command.sessionId);
          await save();
          await changed(command.sessionId);
          return {};
        }
        case "session.archive": {
          const summary = (await summaries()).find((session) => session.id === command.sessionId);
          if (!summary) throw new CommandError("session_not_found");
          const current = sessions.get(command.sessionId);
          if (
            (!current &&
              isSqliteSessionBusy({
                cwd: summary.cwd,
                homeDir: options.homeDir,
                dataRoot: options.dataRoot,
                id: summary.id,
              })) ||
            openings.has(command.sessionId) ||
            (current && executing(current)) ||
            [...pending.values()].some((item) => item.sessionId === command.sessionId)
          )
            throw new CommandError("session_busy");
          registry.pinned = registry.pinned.filter((id) => id !== command.sessionId);
          if (!registry.archived.includes(command.sessionId))
            registry.archived.push(command.sessionId);
          await save();
          await changed(command.sessionId);
          return {};
        }
        case "session.rename": {
          if (!command.title.trim()) throw new CommandError("invalid_command");
          const current = sessions.get(command.sessionId);
          if (current) await current.rename(command.title);
          else {
            const summary = (await summaries()).find((item) => item.id === command.sessionId);
            if (!summary) throw new CommandError("session_not_found");
            await renameSessionTitle({
              cwd: summary.cwd,
              homeDir: options.homeDir,
              dataRoot: options.dataRoot,
              id: summary.id,
              title: command.title,
            });
          }
          await changed();
          return {};
        }
        case "session.pin":
        case "session.unpin": {
          if (!(await summaries()).some((session) => session.id === command.sessionId))
            throw new CommandError("session_not_found");
          if (command.type === "session.pin" && registry.archived.includes(command.sessionId))
            throw new CommandError("session_archived");
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
    // Reserve each Session before the first await, including model/auth/open preparation.
    // Archive/delete exclude other commands until storage/registry publication completes.
    const dispatch = async (command: WireCommand, socket: WSContext): Promise<unknown> => {
      if (!("sessionId" in command) || !command.sessionId) return executeCommand(command, socket);
      const id = command.sessionId;
      if (organizing.has(id)) throw new CommandError("session_busy");
      if (
        command.type === "session.delete" ||
        command.type === "session.archive" ||
        command.type === "session.move"
      ) {
        if ((sessionCommands.get(id) ?? 0) > 0) throw new CommandError("session_busy");
        organizing.add(id);
        try {
          return await executeCommand(command, socket);
        } finally {
          organizing.delete(id);
          const session = sessions.get(id);
          if (session) refreshIdle(session);
        }
      }
      sessionCommands.set(id, (sessionCommands.get(id) ?? 0) + 1);
      try {
        return await executeCommand(command, socket);
      } finally {
        const count = (sessionCommands.get(id) ?? 1) - 1;
        if (count) sessionCommands.set(id, count);
        else sessionCommands.delete(id);
        const session = sessions.get(id);
        if (session) refreshIdle(session);
      }
    };
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
          if (!Value.Check(ModelOperation, input))
            return c.json({ error: "invalid-operation" }, 400);
          return c.json(await modelOperation(input, c.req.raw.signal));
        } catch (error) {
          return c.json(
            {
              error:
                error instanceof ModelServiceFailure
                  ? error.privateError
                  : "model-service-operation-failed",
            },
            409,
          );
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
                const publicError = publicWireError(error);
                const code =
                  error instanceof CommandError || error instanceof HostError
                    ? error.code
                    : publicError
                      ? publicError.code
                      : error instanceof Error && "code" in error && error.code === "session-busy"
                        ? "session_busy"
                        : error instanceof Error &&
                            "code" in error &&
                            error.code === "session-not-found"
                          ? "session_not_found"
                          : error instanceof Error &&
                              "code" in error &&
                              error.code === "session-title-empty"
                            ? "invalid_command"
                            : "internal";
                if (code === "internal") warning(String(error));
                send(socket, {
                  type: "response",
                  id: command.id,
                  error: {
                    code,
                    ...(error instanceof CommandError && error.params
                      ? { params: error.params }
                      : publicError?.params
                        ? { params: publicError.params }
                        : {}),
                  },
                });
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
