import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const workers = process.env.RUKIE_TEST_WORKERS ?? "4";
let active: ReturnType<typeof Bun.spawn> | undefined;
let interrupted = 0;
const interrupt = (signal: "SIGINT" | "SIGTERM") => {
  interrupted = signal === "SIGINT" ? 130 : 143;
  active?.kill(signal);
};
const onInterrupt = () => interrupt("SIGINT");
const onTerminate = () => interrupt("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);

async function run(argv: string[], env = process.env) {
  if (interrupted) return interrupted;
  active = Bun.spawn([process.execPath, ...argv], {
    cwd: root,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await active.exited;
  active = undefined;
  return interrupted || code;
}

let owned: string | undefined;
try {
  if (args.length || process.env.RUKIE_RELEASE_ARTIFACTS) {
    // Focused commands and CI shards retain Bun's native selection and argument handling.
    process.exitCode = await run(["test", `--parallel=${workers}`, ...args]);
  } else {
    // Real Session, frontend/process integration and native installation own separate phases.
    // Other workspaces and script tests retain the configured parallelism.
    owned = await mkdtemp(join(tmpdir(), "rukie-local-tests-"));
    let code = await run(["--no-orphans", "scripts/release/build.ts", "--out", owned]);
    if (!code) {
      const packages = (await readdir(join(root, "packages"), { withFileTypes: true }))
        .filter(
          (entry) => entry.isDirectory() && entry.name !== "coding-agent" && entry.name !== "agent",
        )
        .map((entry) => join("packages", entry.name));
      const agentModules = (
        await readdir(join(root, "packages/agent/tests"), { withFileTypes: true })
      )
        .filter(
          (entry) =>
            entry.name !== "e2e" &&
            (entry.isDirectory() || /\.test\.[cm]?[jt]sx?$/.test(entry.name)),
        )
        .map((entry) => join("packages/agent/tests", entry.name));
      // Bun's configured exclusions still own the Vitest boundary for these workspaces.
      code = await run([
        "test",
        `--parallel=${workers}`,
        ...packages,
        ...agentModules,
        "scripts/tests",
      ]);
    }
    if (!code) code = await run(["test", "--parallel=1", "packages/agent/tests/e2e"]);
    if (!code) code = await run(["test", "--parallel=1", "packages/coding-agent"]);
    if (!code)
      code = await run(["test", "--parallel=1", "scripts/release/tests"], {
        ...process.env,
        RUKIE_RELEASE_ARTIFACTS: owned,
      });
    process.exitCode = code;
  }
} finally {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  if (owned) await rm(owned, { recursive: true, force: true });
}
