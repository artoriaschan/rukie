import { withExternalImages, cleanupExternalFiles } from "./external-files.ts";
import { userDataDirectory, type UserDataOptions } from "../config/paths.ts";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import {
  createSession as createNativeSession,
  defineDoc,
  type Storage,
} from "@earendil-works/pi-durable";
import {
  SqliteStorage,
  CURRENT_SQLITE_SCHEMA_VERSION,
} from "@earendil-works/pi-durable/storage/sqlite";
import type { SqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite";
import { createSqliteOutputs, readSqliteOutput, type SqliteOutputs } from "./output.ts";
import type { ToolOutputRef, JobOutput } from "@rukie/shared";
import { openBunSqliteDatabase } from "./sqlite-database.ts";
import { JsonlStorage } from "@earendil-works/pi-durable/storage/jsonl";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { err, ok, FileError, type FileSystem } from "@earendil-works/pi-durable/env";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { createUserVisibleError, type Settings } from "@rukie/shared";
import { normalizeUserTitle, titleSourceState, type TitleSource } from "../session-title/index.ts";
import { CommittedFiles } from "./files.ts";

const metadataSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    cwd: Type.String({ minLength: 1 }),
    title: Type.String(),
    titleSource: Type.Union([Type.Literal("prompt"), Type.Literal("model"), Type.Literal("user")]),
    model: Type.String({ minLength: 1 }),
    activeConversationId: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    updatedAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    messageCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);
/** Validate persisted index facts; native typed access separately rejects unsupported document versions. */
export function parseSessionMetadata(value: unknown): Static<typeof metadataSchema> {
  if (!Value.Check(metadataSchema, value)) throw new Error("Invalid Session metadata.");
  return value;
}
export const SessionMetadataDoc = defineDoc<Static<typeof metadataSchema>>({
  kind: "rukie.session",
  version: 1,
  scope: "session",
  initial: () => ({
    id: "",
    cwd: "",
    title: "",
    titleSource: "prompt",
    model: "",
    activeConversationId: 0,
    updatedAt: 0,
    messageCount: 0,
  }),
});

export interface SessionSummary {
  id: string;
  title: string;
  titleSource: TitleSource;
  /** Birth time of the store directory; independent of subsequent Transcript updates. */
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  model: string;
}
export interface SessionStorageLease {
  id: string;
  storage: Storage;
  outputs?: SqliteOutputs;
  release(): Promise<void>;
}
/** Native storage ownership, never a legacy Session repository. */
export interface SessionStore {
  open(options: { id?: string }, context: Context): Promise<SessionStorageLease>;
  /** Skip unreadable indexes, reporting each failure without recovering or repairing storage. */
  list(context: Context, onWarning?: (warning: string) => void): Promise<SessionSummary[]>;
  key(id: string): string;
}
const liveReaders = new Map<string, () => Promise<Omit<SessionSummary, "createdAt">>>();
export function registerSessionReader(
  store: SessionStore,
  id: string,
  read: () => Promise<Omit<SessionSummary, "createdAt">>,
) {
  const key = store.key(id);
  if (liveReaders.has(key))
    throw createUserVisibleError(`Session already open: ${id}`, {
      code: "session-busy",
      params: { id },
    });
  liveReaders.set(key, read);
  return () => {
    if (liveReaders.get(key) === read) liveReaders.delete(key);
  };
}

function readonlyFiles(files: FileSystem): FileSystem {
  const mutations = new Set<PropertyKey>([
    "writeFile",
    "appendFile",
    "truncateFile",
    "flushFile",
    "renameFile",
    "remove",
    "createTempDir",
    "createTempFile",
  ]);
  return new Proxy(files, {
    get(target, key) {
      if (mutations.has(key))
        return async () =>
          Promise.reject(
            createUserVisibleError(
              "Session history requires repair and cannot be viewed read-only.",
              { code: "session-observation-readonly", params: {} },
            ),
          );
      if (key === "createDir")
        return async (path: string, _options: unknown, context: Context) => {
          const result = await target.fileInfo(path, context);
          return result.ok && result.value.kind === "directory"
            ? ok(undefined)
            : err(new FileError("permission_denied", "Session observation cannot create storage."));
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
function validId(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw createUserVisibleError(`Session not found: ${id}`, {
      code: "session-not-found",
      params: { id },
    });
}

/** Frontends select their backend once from the explicit application root. */
export function createSessionStore(options: UserDataOptions & { cwd: string }): SessionStore {
  return options.dataRoot ? createSqliteStore(options) : createJsonlStore(options);
}
export function createJsonlStore(options: UserDataOptions & { cwd: string }): SessionStore {
  return createStore(options, false);
}
export function createSqliteStore(options: UserDataOptions & { cwd: string }): SessionStore {
  if (!options.dataRoot)
    throw new Error("SQLite Session storage requires an application data root.");
  return createStore(options, true);
}

/** Point-in-time desktop busy observation. Briefly probes only the host mutex, never opens a Session.
 * No data is written; execution must still acquire its own lease afterward.
 */
export function isSqliteSessionBusy(
  options: UserDataOptions & { cwd: string; id: string },
): boolean {
  validId(options.id);
  if (!options.dataRoot)
    throw new Error("Desktop busy observation requires an application data root.");
  const database = new Database(
    join(createSqliteStore(options).key(options.id), "host-lease.sqlite"),
    { readwrite: true, create: false },
  );
  try {
    database.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;");
    database.exec("ROLLBACK;");
    return false;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "SQLITE_BUSY") return true;
    throw error;
  } finally {
    database.close();
  }
}
/** Commit a user-owned title and release the lease before resolving. No model or credential access.
 * Missing/cwd-mismatched storage rejects with session-not-found; occupied leases reject with session-busy
 * before any Session data changes. Empty normalized titles reject with session-title-empty.
 */
export async function renameSessionTitle(
  options: UserDataOptions & { cwd: string; id: string; title: string },
): Promise<void> {
  const { id, title } = options;
  const cwd = resolve(options.cwd);
  const sqlite = !!options.dataRoot;
  const storageName = sqlite ? "session.sqlite" : "main.jsonl";
  const context = BACKGROUND_CONTEXT;
  validId(id);
  const normalized = normalizeUserTitle(title);
  const directory = createSessionStore(options).key(id);
  const path = join(directory, storageName);
  if (!(await Bun.file(path).exists()))
    throw createUserVisibleError(`Session not found: ${id}`, {
      code: "session-not-found",
      params: { id },
    });
  const lease = acquireWriterLease(directory, id);
  const files = new CommittedFiles({ cwd });
  let database: SqliteDatabase | undefined;
  let kernel: ReturnType<typeof createNativeSession> | undefined;
  try {
    if (sqlite) {
      // Validate the existing schema and identity before opening a mutable adapter.
      const reader = createNativeSession(await openReadonlySqliteStorage(path));
      try {
        const metadata = parseSessionMetadata(await reader.snapshot(SessionMetadataDoc, context));
        if (metadata.id !== id || metadata.cwd !== cwd)
          throw createUserVisibleError(`Session not found: ${id}`, {
            code: "session-not-found",
            params: { id },
          });
      } finally {
        await reader.close(BACKGROUND_CONTEXT);
      }
      database = await openBunSqliteDatabase(path);
    }
    const storage = database
      ? await SqliteStorage.open(database)
      : await JsonlStorage.open(directory, files, context, { fsync: true });
    kernel = createNativeSession(storage);
    const metadata = parseSessionMetadata(await kernel.snapshot(SessionMetadataDoc, context));
    const conversation = (
      await storage.scanConversations({}, 100000, undefined, context)
    ).items.find((row) => Number(row.id) === metadata.activeConversationId);
    if (!conversation) throw new Error("Active conversation is missing.");
    await kernel.commit(async (tx) => {
      const doc = await tx.doc(SessionMetadataDoc);
      doc.title = normalized;
      doc.titleSource = "user";
      doc.updatedAt = Date.now();
      (await tx.doc(titleSourceState.document, conversation.id)).value = titleSourceState.parse(
        titleSourceState.version,
        "user",
      );
    }, context);
  } finally {
    try {
      if (kernel) await kernel.close(BACKGROUND_CONTEXT);
      else await database?.close();
    } finally {
      try {
        await files.cleanup(BACKGROUND_CONTEXT);
      } finally {
        lease.close();
      }
    }
  }
}

function acquireWriterLease(directory: string, id: string): Database {
  // Retain the mutex inode: unlinking permits a second owner to lock another inode.
  // Its writer reservation excludes other hosts without EXCLUSIVE lock upgrades.
  const lease = new Database(join(directory, "host-lease.sqlite"), { create: true });
  try {
    lease.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;");
    return lease;
  } catch (error) {
    lease.close();
    throw createUserVisibleError(
      `Session already open: ${id}`,
      {
        code: "session-busy",
        params: { id },
      },
      { cause: error },
    );
  }
}

function createStore(options: UserDataOptions & { cwd: string }, sqlite: boolean): SessionStore {
  const cwd = resolve(options.cwd);
  const project = createHash("sha256").update(cwd).digest("hex");
  const root = sqlite
    ? join(userDataDirectory(options), "sessions")
    : join(userDataDirectory(options), "durable-sessions", project);
  const storageName = sqlite ? "session.sqlite" : "main.jsonl";
  const key = (id: string) => join(root, id);
  return {
    key,
    async open({ id }, context) {
      const sessionId = id ?? crypto.randomUUID();
      validId(sessionId);
      const directory = key(sessionId);
      if (id && !(await Bun.file(join(directory, storageName)).exists()))
        throw createUserVisibleError(`Session not found: ${id}`, {
          code: "session-not-found",
          params: { id },
        });
      await mkdir(directory, { recursive: true });
      const lease = acquireWriterLease(directory, sessionId);
      const files = new CommittedFiles({ cwd });
      let database: SqliteDatabase | undefined;
      try {
        if (sqlite && id) {
          const reader = createNativeSession(
            await openReadonlySqliteStorage(join(directory, storageName)),
          );
          try {
            const metadata = parseSessionMetadata(
              await reader.snapshot(SessionMetadataDoc, context),
            );
            if (metadata.cwd !== cwd || metadata.id !== id)
              throw createUserVisibleError(`Session not found: ${id}`, {
                code: "session-not-found",
                params: { id },
              });
          } finally {
            await reader.close(BACKGROUND_CONTEXT);
          }
        }
        database = sqlite ? await openBunSqliteDatabase(join(directory, storageName)) : undefined;
        const outputs = database ? await createSqliteOutputs(database) : undefined;
        const storage = database
          ? withExternalImages(await SqliteStorage.open(database), options.dataRoot!, sessionId)
          : await JsonlStorage.open(directory, files, context, { fsync: true });
        let released = false;
        return {
          id: sessionId,
          storage,
          outputs,
          async release() {
            if (released) return;
            released = true;
            try {
              if (database) {
                try {
                  await cleanupExternalFiles(database, options.dataRoot!, sessionId);
                } finally {
                  await storage.close(BACKGROUND_CONTEXT);
                }
              }
            } finally {
              try {
                await files.cleanup(BACKGROUND_CONTEXT);
              } finally {
                lease.close();
              }
            }
          },
        };
      } catch (error) {
        await database?.close();
        lease.close();
        await files.cleanup(BACKGROUND_CONTEXT);
        throw error;
      }
    },
    async list(context, onWarning = console.warn) {
      let directories;
      try {
        directories = await readdir(root, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const results: SessionSummary[] = [];
      for (const directory of directories) {
        if (!directory.isDirectory()) continue;
        try {
          const createdAt = (await stat(key(directory.name))).birthtimeMs;
          const reader = liveReaders.get(key(directory.name));
          if (reader && !sqlite) {
            results.push({ ...(await reader()), createdAt });
            continue;
          }
          if (!(await Bun.file(join(key(directory.name), storageName)).exists())) continue;
          const files = new NodeExecutionEnv({ cwd });
          let nativeSession: ReturnType<typeof createNativeSession> | undefined;
          try {
            const storage = sqlite
              ? await openReadonlySqliteStorage(join(key(directory.name), storageName))
              : await JsonlStorage.open(key(directory.name), readonlyFiles(files), context);
            // The storage kernel reads committed documents without Harness recovery,
            // which may append retry/uncertainty facts for unfinished native work.
            nativeSession = createNativeSession(storage);
            const snapshot = await nativeSession.snapshot(SessionMetadataDoc, context);
            if (!snapshot) continue;
            const metadata = parseSessionMetadata(snapshot);
            if (metadata.cwd !== cwd || metadata.id !== directory.name) continue;
            results.push({
              id: metadata.id,
              title: metadata.title,
              titleSource: metadata.titleSource,
              model: metadata.model,
              createdAt,
              updatedAt: metadata.updatedAt,
              messageCount: metadata.messageCount,
            });
          } finally {
            try {
              await nativeSession?.close(BACKGROUND_CONTEXT);
            } finally {
              await files.cleanup(BACKGROUND_CONTEXT);
            }
          }
        } catch (error) {
          onWarning(
            `Could not read Session ${directory.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return results.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    },
  };
}
/** Observe committed storage without acquiring a writer lease, recovery or repair. The callback must only read. */
export async function readSessionStorage<T>(
  options: UserDataOptions & { cwd: string; id: string },
  read: (storage: Storage) => Promise<T>,
): Promise<T> {
  validId(options.id);
  const directory = createSessionStore(options).key(options.id);
  const storageName = options.dataRoot ? "session.sqlite" : "main.jsonl";
  if (!(await Bun.file(join(directory, storageName)).exists()))
    throw createUserVisibleError(`Session not found: ${options.id}`, {
      code: "session-not-found",
      params: { id: options.id },
    });
  const files = new NodeExecutionEnv({ cwd: options.cwd });
  let storage: Storage | undefined;
  try {
    storage = options.dataRoot
      ? await openReadonlySqliteStorage(join(directory, storageName))
      : await JsonlStorage.open(directory, readonlyFiles(files), BACKGROUND_CONTEXT);
    return await read(storage);
  } finally {
    try {
      await storage?.close(BACKGROUND_CONTEXT);
    } finally {
      await files.cleanup(BACKGROUND_CONTEXT);
    }
  }
}

export async function listSessions(options: {
  cwd: string;
  homeDir?: string;
  dataRoot?: string;
  store?: SessionStore;
  settings?: Settings;
  /** Receives failures for individual Session indexes; root directory failures still reject. */
  onWarning?: (warning: string) => void;
}): Promise<SessionSummary[]> {
  const store =
    options.store ??
    createSessionStore({
      cwd: options.cwd,
      homeDir: options.homeDir ?? homedir(),
      dataRoot: options.dataRoot,
    });
  return store.list(BACKGROUND_CONTEXT, options.onWarning);
}

/** Native read semantics over a pinned WAL frame, without open()'s schema migrations. */
async function openReadonlySqliteStorage(
  path: string,
  opened?: (database: SqliteDatabase) => void,
): Promise<Storage> {
  const db = await openBunSqliteDatabase(path, { readonly: true });
  try {
    const schema = await db.get<{ version: number }>(
      "SELECT version FROM durable_schema WHERE singleton = 1",
    );
    if (schema?.version !== CURRENT_SQLITE_SCHEMA_VERSION)
      throw new Error(`Unsupported read-only Session schema: ${schema?.version ?? "missing"}.`);
    // Verify every native read table/column before exposing the locked constructor.
    for (const sql of [
      "SELECT next_id, next_seq FROM durable_metadata LIMIT 0",
      "SELECT id, record_type FROM record_ids LIMIT 0",
      "SELECT id, owner_conversation_id, owner_task_id, record FROM conversations LIMIT 0",
      "SELECT id, conversation_id, head, commit_seq, record FROM entries LIMIT 0",
      "SELECT id, conversation_id, kind, status, abort_requested, background, record FROM tasks LIMIT 0",
      "SELECT id, conversation_id, request_id, status, record FROM submissions LIMIT 0",
      "SELECT id, kind, family, key_value, scope_kind, owner_id, created_at, retired_at, record FROM documents LIMIT 0",
      "SELECT document_id, seq, kind, version, content FROM document_revisions LIMIT 0",
    ])
      await db.all(sql);
    const metadata = await db.get<{ next_id: string; next_seq: number }>(
      "SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1",
    );
    const nextId = Number(metadata?.next_id);
    if (
      !Number.isSafeInteger(nextId) ||
      nextId < 2 ||
      !Number.isSafeInteger(metadata?.next_seq) ||
      metadata!.next_seq < 1
    )
      throw new Error("Invalid durable SQLite metadata.");
    // Locked pi-durable's constructor only stores (db, nextId); open() adds migrations.
    // Reflect.construct retains native reads without duplicating its document/history engine.
    const storage: SqliteStorage = Reflect.construct(SqliteStorage, [db, nextId]);
    opened?.(db);
    return withExternalImages(
      new Proxy(storage, {
        get(target, key) {
          if (key === "commit" || key === "mintId")
            return async () => {
              throw new Error("Session observation is read-only.");
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
      resolve(path, "../../.."),
      dirname(path).split("/").at(-1)!,
    );
  } catch (error) {
    await db.close();
    throw error;
  }
}

/** Discover committed application Session facts even when a project is no longer registered. */
export async function discoverSqliteSessions(
  options: UserDataOptions & { dataRoot: string; onWarning?: (warning: string) => void },
): Promise<(SessionSummary & { cwd: string })[]> {
  const root = join(userDataDirectory(options), "sessions");
  let directories;
  try {
    directories = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const results: (SessionSummary & { cwd: string })[] = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    if (!(await Bun.file(join(root, directory.name, "session.sqlite")).exists())) continue;
    try {
      const metadata = await readSessionStorage(
        { ...options, cwd: "/", id: directory.name },
        async (storage) => {
          const kernel = createNativeSession(storage);
          try {
            return parseSessionMetadata(
              await kernel.snapshot(SessionMetadataDoc, BACKGROUND_CONTEXT),
            );
          } finally {
            await kernel.close(BACKGROUND_CONTEXT);
          }
        },
      );
      if (metadata.id !== directory.name)
        throw new Error("Session metadata identity does not match storage.");
      const { id, cwd, title, titleSource, model, updatedAt, messageCount } = metadata;
      results.push({
        id,
        cwd,
        title,
        titleSource,
        model,
        updatedAt,
        messageCount,
        createdAt: (await stat(join(root, id))).birthtimeMs,
      });
    } catch (error) {
      (options.onWarning ?? console.warn)(
        `Could not read Session ${directory.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

/** Read historical desktop output without execution ownership, recovery, or schema mutation. */
export async function readSessionToolOutput(
  options: UserDataOptions & { cwd: string; id: string },
  ref: ToolOutputRef,
  from = 0,
  maxBytes = 256 * 1024,
): Promise<JobOutput> {
  validId(options.id);
  if (!options.dataRoot) throw new Error("Historical tool output requires SQLite Session storage");
  let database: SqliteDatabase | undefined;
  const storage = await openReadonlySqliteStorage(
    join(createSessionStore(options).key(options.id), "session.sqlite"),
    (db) => {
      database = db;
    },
  );
  const kernel = createNativeSession(storage);
  try {
    const metadata = parseSessionMetadata(
      await kernel.snapshot(SessionMetadataDoc, BACKGROUND_CONTEXT),
    );
    if (metadata.id !== options.id || metadata.cwd !== resolve(options.cwd))
      throw createUserVisibleError(`Session not found: ${options.id}`, {
        code: "session-not-found",
        params: { id: options.id },
      });
    if (!database) throw new Error("Missing Session output connection");
    return await readSqliteOutput(database, ref, from, maxBytes);
  } finally {
    await kernel.close(BACKGROUND_CONTEXT);
  }
}
