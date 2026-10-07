import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Fresh project and home with valid backup storage; opt out to exercise missing or invalid storage. */
export async function tempDirs({ fileHistory = true }: { fileHistory?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "rukie-test-"));
  const cwd = join(root, "project");
  const homeDir = join(root, "home");
  await Promise.all([Bun.write(join(cwd, ".keep"), ""), Bun.write(join(homeDir, ".keep"), "")]);
  if (fileHistory) await mkdir(join(homeDir, ".rukie", "file-history"), { recursive: true });
  return { cwd, homeDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}
