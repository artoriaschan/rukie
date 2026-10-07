import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import { createModels } from "@earendil-works/pi-ai";
import { Harness, createRegistry, defineDoc, type Storage } from "@earendil-works/pi-durable";
import { JsonlStorage } from "@earendil-works/pi-durable/storage/jsonl";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { err, ok, FileError, type FileSystem } from "@earendil-works/pi-durable/env";
import { createUserVisibleError, type Settings } from "@rukie/shared";
import type { TitleSource } from "../session-title/index.ts";

export const SessionMetadataDoc = defineDoc<{
  id: string;
  cwd: string;
  title: string;
  titleSource: TitleSource;
  model: string;
  activeConversationId: number;
  updatedAt: number;
  messageCount: number;
}>({
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
  updatedAt: number;
  messageCount: number;
  model: string;
}
export interface SessionStorageLease {
  id: string;
  storage: Storage;
  release(): Promise<void>;
}
/** Native storage ownership, never a legacy Session repository. */
export interface SessionStore {
  open(options: { id?: string }, context: Context): Promise<SessionStorageLease>;
  list(context: Context): Promise<SessionSummary[]>;
  key(id: string): string;
}
const liveReaders = new Map<string, () => Promise<SessionSummary>>();
export function registerSessionReader(
  store: SessionStore,
  id: string,
  read: () => Promise<SessionSummary>,
) {
  const key = store.key(id);
  if (liveReaders.has(key)) throw new Error(`Session already open: ${id}`);
  liveReaders.set(key, read);
  return () => {
    if (liveReaders.get(key) === read) liveReaders.delete(key);
  };
}

/** Native fsync flushes sidecars; main append must also finish its flush before adoption. */
class CommittedFiles extends NodeExecutionEnv {
  override async appendFile(...args: Parameters<NodeExecutionEnv["appendFile"]>) {
    const result = await super.appendFile(...args);
    return result.ok ? this.flushFile(args[0], args[2]) : result;
  }
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

export function createJsonlStore(options: { cwd: string; homeDir: string }): SessionStore {
  const cwd = resolve(options.cwd);
  const project = createHash("sha256").update(cwd).digest("hex");
  const root = join(options.homeDir, ".rukie", "durable-sessions", project);
  const key = (id: string) => join(root, id);
  return {
    key,
    async open({ id }, context) {
      const sessionId = id ?? crypto.randomUUID();
      validId(sessionId);
      const directory = key(sessionId);
      if (id && !(await Bun.file(join(directory, "main.jsonl")).exists()))
        throw createUserVisibleError(`Session not found: ${id}`, {
          code: "session-not-found",
          params: { id },
        });
      await mkdir(directory, { recursive: true });
      // This database contains no Session records; its kernel lease protects native JSONL.
      // Retain its inode forever: unlinking permits a second owner to lock another inode.
      const lease = new Database(join(directory, "host-lease.sqlite"), { create: true });
      try {
        lease.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
      } catch (error) {
        lease.close();
        throw new Error(`Session already open: ${sessionId}`, { cause: error });
      }
      const files = new CommittedFiles({ cwd });
      try {
        const storage = await JsonlStorage.open(directory, files, context, { fsync: true });
        let released = false;
        return {
          id: sessionId,
          storage,
          async release() {
            if (released) return;
            released = true;
            try {
              await files.cleanup(BACKGROUND_CONTEXT);
            } finally {
              lease.close();
            }
          },
        };
      } catch (error) {
        lease.close();
        await files.cleanup(BACKGROUND_CONTEXT);
        throw error;
      }
    },
    async list(context) {
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
        const reader = liveReaders.get(key(directory.name));
        if (reader) {
          results.push(await reader());
          continue;
        }
        if (!(await Bun.file(join(key(directory.name), "main.jsonl")).exists())) continue;
        const files = new NodeExecutionEnv({ cwd });
        const storage = await JsonlStorage.open(key(directory.name), readonlyFiles(files), context);
        const harness = await Harness.open(
          storage,
          { models: createModels(), registry: createRegistry() },
          context,
        );
        try {
          const metadata = await harness.snapshot(SessionMetadataDoc, context);
          if (!metadata || metadata.cwd !== cwd || metadata.id !== directory.name) continue;
          results.push({
            id: metadata.id,
            title: metadata.title,
            titleSource: metadata.titleSource,
            model: metadata.model,
            updatedAt: metadata.updatedAt,
            messageCount: metadata.messageCount,
          });
        } finally {
          await harness.close(BACKGROUND_CONTEXT);
          await files.cleanup(BACKGROUND_CONTEXT);
        }
      }
      return results.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    },
  };
}
export async function listSessions(options: {
  cwd: string;
  homeDir?: string;
  store?: SessionStore;
  settings?: Settings;
}): Promise<SessionSummary[]> {
  const store =
    options.store ?? createJsonlStore({ cwd: options.cwd, homeDir: options.homeDir ?? homedir() });
  return store.list(BACKGROUND_CONTEXT);
}
