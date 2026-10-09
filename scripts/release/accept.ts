import { resolve } from "node:path";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { "artifact-dir": { type: "string", default: "dist/release" } },
});
const child = Bun.spawn(
  [
    process.execPath,
    "test",
    "scripts/release/tests/installation.test.ts",
    "scripts/release/tests/tui.test.ts",
    "scripts/release/tests/providers.test.ts",
  ],
  {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...process.env, RUKIE_RELEASE_ARTIFACTS: resolve(values["artifact-dir"]!) },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exitCode = await child.exited;
