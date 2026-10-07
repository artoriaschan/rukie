import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { err, FileError, ok, type FileSystem } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/pi-agent-core/harness/context";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";
import {
  JsonlSessionRepo,
  type SessionCreateOptions,
  type SessionMetadata,
  type SessionRepo,
  type Session as StoredSession,
} from "@earendil-works/pi-agent-core/harness/session";
import { createUserVisibleError, type Settings } from "@rukie/shared";
import { loadSettings, modelState } from "../config/index.ts";
import { titleSourceState, type TitleSource } from "../session-title/index.ts";
import { createToolState } from "../tool-state/index.ts";

type Repo = SessionRepo<
  SessionMetadata,
  SessionCreateOptions & { cwd: string },
  { cwd: string } | undefined
>;
/** The pi repo capabilities used by Agent Core; another backend can supply them. */
export type SessionStore = Pick<Repo, "create" | "open" | "list"> & {
  /** Targeted metadata lookup, avoiding unrelated Session headers on resume. */
  find?(
    id: string,
    options: { cwd: string },
    context: Context,
  ): Promise<SessionMetadata | undefined>;
  /** Observation must never mutate storage, including native open-time repairs. */
  openReadonly?: Repo["open"];
};

class ReadonlyObservationError extends FileError {}

/** Native decoding stays in pi; even its torn-tail repair cannot write through this view. */
function readonlyFiles(files: FileSystem, id?: string): FileSystem {
  const mutations = new Set<PropertyKey>([
    "writeFile",
    "appendFile",
    "renameFile",
    "createDir",
    "remove",
    "createTempDir",
    "createTempFile",
  ]);
  return new Proxy(files, {
    get(target, key) {
      if (mutations.has(key))
        return async () =>
          err(
            new ReadonlyObservationError("permission_denied", "Session observation is read-only."),
          );
      if (key === "listDir" && id !== undefined)
        return async (path: string, context: Context) => {
          const result = await target.listDir(path, context);
          return result.ok
            ? ok(
                result.value.filter((file) =>
                  file.name.endsWith(`_${encodeURIComponent(id)}.jsonl`),
                ),
              )
            : result;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type SessionReader = <T>(read: (session: StoredSession) => Promise<T>) => Promise<T>;
const liveReaders = new WeakMap<SessionStore, Map<string, SessionReader>>();

/** A live Session lends its serialized storage lease; no metadata is cached here. */
export function registerSessionReader(store: SessionStore, id: string, reader: SessionReader) {
  let readers = liveReaders.get(store);
  if (!readers) liveReaders.set(store, (readers = new Map()));
  readers.set(id, reader);
  return () => {
    if (readers.get(id) === reader) readers.delete(id);
  };
}

/** pi owns project slugs, file naming and its native JSONL v4 encoding. */
export function createJsonlStore(options: { cwd: string; homeDir: string }): SessionStore {
  const files = new NodeExecutionEnv({ cwd: options.cwd });
  const sessionsRoot = join(options.homeDir, ".rukie/sessions");
  const repo = new JsonlSessionRepo({ fileSystem: files, sessionsRoot });
  const readonly = new JsonlSessionRepo({ fileSystem: readonlyFiles(files), sessionsRoot });
  return {
    create: repo.create.bind(repo),
    open: repo.open.bind(repo),
    list: repo.list.bind(repo),
    async find(id, options, context) {
      const scoped = new JsonlSessionRepo({ fileSystem: readonlyFiles(files, id), sessionsRoot });
      try {
        return (await scoped.list(options, context)).find((row) => row.id === id);
      } finally {
        await scoped.close(context);
      }
    },
    openReadonly: async (...args: Parameters<typeof readonly.open>) => {
      try {
        return await readonly.open(...args);
      } catch (error) {
        // Native I/O wrappers preserve the denial as a cause; other failures stay intact.
        let cause: unknown = error;
        while (cause instanceof Error) {
          if (cause instanceof ReadonlyObservationError)
            throw createUserVisibleError(
              "Session history requires repair and cannot be viewed read-only.",
              { code: "session-observation-readonly", params: {} },
              { cause: error },
            );
          cause = cause.cause;
        }
        throw error;
      }
    },
  };
}

export interface SessionSummary {
  id: string;
  title: string;
  titleSource: TitleSource;
  updatedAt: number;
  messageCount: number;
  model: string;
}

/** Read native session metadata and branch state without maintaining a second index. */
export async function listSessions(options: {
  cwd: string;
  homeDir?: string;
  store?: SessionStore;
  settings?: Settings;
}): Promise<SessionSummary[]> {
  const cwd = resolve(options.cwd);
  const homeDir = options.homeDir ?? homedir();
  const store = options.store ?? createJsonlStore({ cwd, homeDir });
  const settings = options.settings ?? (await loadSettings({ cwd, homeDir })).settings;
  const context = BACKGROUND_CONTEXT;
  const summaries: SessionSummary[] = [];
  for (const metadata of await store.list({ cwd }, context)) {
    if (
      metadata.parentSessionId ||
      metadata.legacyParentSessionPath ||
      (metadata.cwd && resolve(metadata.cwd) !== cwd)
    )
      continue;
    const read = async (session: StoredSession) => {
      const branch = await session.branch("main", context);
      const entries = (await branch?.findEntries({ order: "oldestFirst" }, context)) ?? [];
      const state = createToolState([modelState, titleSourceState], entries, () => {});
      const name = await session.getName(context);
      const stats = await session.getStats(context);
      const messages = entries.flatMap((entry) =>
        entry.type === "message" ? [entry.message] : [],
      );
      const lastAssistant = messages.findLast((message) => message.role === "assistant");
      const modifiedAt =
        "modifiedAt" in metadata && typeof metadata.modifiedAt === "number"
          ? metadata.modifiedAt
          : undefined;
      const allEntries =
        modifiedAt === undefined ? await session.findEntries({ order: "desc" }, context) : [];
      summaries.push({
        id: metadata.id,
        title: name ?? metadata.id,
        titleSource: (state.get("title-source") as TitleSource) ?? (name ? "user" : "prompt"),
        updatedAt: modifiedAt ?? allEntries[0]?.timestamp ?? metadata.createdAt,
        messageCount: stats.messageCount,
        model:
          (state.get("model") as string) ??
          (lastAssistant
            ? `${lastAssistant.provider}/${lastAssistant.model}`
            : (settings.model ?? "")),
      });
    };
    const reader = liveReaders.get(store)?.get(metadata.id);
    if (reader) await reader(read);
    else {
      const session = await (store.openReadonly ?? store.open).call(store, metadata, context);
      try {
        await read(session);
      } finally {
        await session.close(context);
      }
    }
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
