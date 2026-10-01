import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Fresh `cwd` and `homeDir` under the OS temp dir; call `cleanup` in `afterEach`. */
export async function tempDirs() {
  const root = await mkdtemp(join(tmpdir(), "neant-test-"));
  const cwd = join(root, "project");
  const homeDir = join(root, "home");
  await Promise.all([Bun.write(join(cwd, ".keep"), ""), Bun.write(join(homeDir, ".keep"), "")]);
  return { cwd, homeDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}
