import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("Bun normal, parallel and shard collection excludes Vitest packages", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "rukie-runner-boundary-"));
  try {
    await writeFile(
      resolve(root, "bunfig.toml"),
      await readFile(resolve(import.meta.dir, "../../bunfig.toml")),
    );
    for (const name of ["ui", "desktop", "server"])
      await mkdir(resolve(root, `packages/${name}/tests`), { recursive: true });
    for (const name of ["ui", "desktop"])
      await writeFile(
        resolve(root, `packages/${name}/tests/runtime.test.ts`),
        'throw new Error("VITEST_COLLECTED_BY_BUN");',
      );
    for (let index = 0; index < 4; index++)
      await writeFile(
        resolve(root, `packages/server/tests/test-${index}.test.ts`),
        'import { test, expect } from "bun:test"; test("Bun fixture", () => expect(true).toBe(true));',
      );
    for (const flags of [[], ["--parallel=2"], ["--shard=1/2"], ["--shard=2/2"]]) {
      const child = Bun.spawn([process.execPath, "test", ...flags], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(child.stderr).text();
      expect(await child.exited).toBe(0);
      expect(output).not.toContain("VITEST_COLLECTED_BY_BUN");
      expect(output).toContain("0 fail");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
