import { join } from "node:path";
import { err, FileError, ok, type FileSystem } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";
import {
  JsonlSessionRepo,
  type SessionCreateOptions,
  type SessionMetadata,
  type SessionRepo,
} from "@earendil-works/pi-agent-core/harness/session";

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
          err(new FileError("permission_denied", "Session observation is read-only."));
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

/** pi owns project slugs, file naming and its native JSONL v4 encoding. */
export function createJsonlStore(options: { cwd: string; homeDir: string }): SessionStore {
  const files = new NodeExecutionEnv({ cwd: options.cwd });
  const sessionsRoot = join(options.homeDir, ".neant/sessions");
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
    openReadonly: readonly.open.bind(readonly),
  };
}
