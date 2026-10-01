import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";
import {
  JsonlSessionRepo,
  type SessionCreateOptions,
  type SessionMetadata,
  type SessionRepo,
} from "@earendil-works/pi-agent-core/harness/session";

/** The pi repo capabilities used by Agent Core; another backend can supply them. */
export type SessionStore = Pick<
  SessionRepo<SessionMetadata, SessionCreateOptions & { cwd: string }, { cwd: string } | undefined>,
  "create" | "open" | "list"
>;

/** pi owns project slugs, file naming and its native JSONL v4 encoding. */
export function createJsonlStore(options: { cwd: string; homeDir: string }): SessionStore {
  return new JsonlSessionRepo({
    fileSystem: new NodeExecutionEnv({ cwd: options.cwd }),
    sessionsRoot: join(options.homeDir, ".neant/sessions"),
  });
}
