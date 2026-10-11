import { userDataDirectory } from "../config/paths.ts";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const retentionMs = 30 * 24 * 60 * 60 * 1000;

export async function cleanupExpiredBackups({
  homeDir,
  dataRoot,
  sessionId,
  now,
  onWarning,
}: {
  homeDir: string;
  dataRoot?: string;
  sessionId: string;
  now: Date;
  onWarning(warning: string): void;
}): Promise<void> {
  // Desktop history can remain referenced by persisted branches in another Session.
  // Age alone cannot authorize deletion; its storage owner must check references.
  if (dataRoot !== undefined) return;
  const history = join(userDataDirectory({ homeDir }), "file-history");
  let entries;
  try {
    entries = await readdir(history, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    onWarning(`Checkpoint backup cleanup failed for ${history}: ${error}`);
    return;
  }
  const cutoff = now.getTime() - retentionMs;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === sessionId) continue;
    const path = join(history, entry.name);
    try {
      if ((await stat(path)).mtimeMs < cutoff) await rm(path, { recursive: true });
    } catch (error) {
      onWarning(`Checkpoint backup cleanup failed for ${path}: ${error}`);
    }
  }
}
