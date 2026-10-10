import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import {
  createSession as createNativeSession,
  defineDoc,
  type Storage,
} from "@earendil-works/pi-durable";
import { JsonlStorage } from "@earendil-works/pi-durable/storage/jsonl";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { err, ok, FileError, type FileSystem } from "@earendil-works/pi-durable/env";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { createUserVisibleError, type Settings } from "@rukie/shared";
import type { TitleSource } from "../session-title/index.ts";
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
  /** Skip unreadable indexes, reporting each failure without recovering or repairing storage. */
  list(context: Context, onWarning?: (warning: string) => void): Promise<SessionSummary[]>;
  key(id: string): string;
}
const liveReaders = new Map<string, () => Promise<SessionSummary>>();
export function registerSessionReader(
  store: SessionStore,
  id: string,
  read: () => Promise<SessionSummary>,
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
      // A writer reservation excludes other hosts without competing EXCLUSIVE lock upgrades.
      const lease = new Database(join(directory, "host-lease.sqlite"), { create: true });
      try {
        lease.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;");
      } catch (error) {
        lease.close();
        throw createUserVisibleError(
          `Session already open: ${sessionId}`,
          {
            code: "session-busy",
            params: { id: sessionId },
          },
          { cause: error },
        );
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
          const reader = liveReaders.get(key(directory.name));
          if (reader) {
            results.push(await reader());
            continue;
          }
          if (!(await Bun.file(join(key(directory.name), "main.jsonl")).exists())) continue;
          const files = new NodeExecutionEnv({ cwd });
          let nativeSession: ReturnType<typeof createNativeSession> | undefined;
          try {
            const storage = await JsonlStorage.open(
              key(directory.name),
              readonlyFiles(files),
              context,
            );
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
export async function listSessions(options: {
  cwd: string;
  homeDir?: string;
  store?: SessionStore;
  settings?: Settings;
  /** Receives failures for individual Session indexes; root directory failures still reject. */
  onWarning?: (warning: string) => void;
}): Promise<SessionSummary[]> {
  const store =
    options.store ?? createJsonlStore({ cwd: options.cwd, homeDir: options.homeDir ?? homedir() });
  return store.list(BACKGROUND_CONTEXT, options.onWarning);
}
