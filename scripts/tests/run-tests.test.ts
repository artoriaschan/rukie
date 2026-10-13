import { expect, onTestFinished, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture(failSource = false) {
  const root = await mkdtemp(join(tmpdir(), "rukie-test-phases-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      child?.kill();
      await child?.exited;
      await rm(root, { recursive: true, force: true });
    })());
  onTestFinished(cleanup);
  await Promise.all(
    [
      "scripts/release/tests",
      "scripts/tests",
      "packages/server/tests",
      "packages/agent/tests/modules",
      "packages/agent/tests/e2e",
      "packages/coding-agent/tests",
    ].map((path) => mkdir(join(root, path), { recursive: true })),
  );
  await copyFile(new URL("../run-tests.ts", import.meta.url), join(root, "scripts/run-tests.ts"));
  await Bun.write(
    join(root, "scripts/release/build.ts"),
    `const out = Bun.argv[Bun.argv.indexOf("--out") + 1];
await Bun.write(out + "/release-build.json", "original fixture bytes");
await Bun.write("built-path", out);
await Bun.write("build-finished", "yes");`,
  );
  await Bun.write(
    join(root, "packages/server/tests/source.test.ts"),
    `import { test, expect } from "bun:test";
test("source phase", async () => {
  expect(await Bun.file("build-finished").text()).toBe("yes");
  expect(process.env.RUKIE_RELEASE_ARTIFACTS).toBeUndefined();
  await Bun.write("source-finished", "yes");
  expect(${failSource}).toBe(false);
});`,
  );
  await Bun.write(
    join(root, "packages/agent/tests/modules/module.test.ts"),
    `import { test, expect } from "bun:test";
test("agent module phase", async () => {
  expect(await Bun.file("build-finished").text()).toBe("yes");
  await Bun.write("agent-module-finished", "yes");
});`,
  );
  await Bun.write(
    join(root, "packages/agent/tests/e2e/session.test.ts"),
    `import { test, expect } from "bun:test";
test("Session integration phase", async () => {
  expect(await Bun.file("source-finished").text()).toBe("yes");
  expect(await Bun.file("agent-module-finished").text()).toBe("yes");
  expect(process.env.RUKIE_RELEASE_ARTIFACTS).toBeUndefined();
  await Bun.write("session-integration-finished", "yes");
});`,
  );
  await Bun.write(
    join(root, "packages/coding-agent/tests/frontend.test.ts"),
    `import { test, expect } from "bun:test";
test("frontend phase", async () => {
  expect(await Bun.file("session-integration-finished").text()).toBe("yes");
  expect(process.env.RUKIE_RELEASE_ARTIFACTS).toBeUndefined();
  await Bun.write("frontend-finished", "yes");
});`,
  );
  await Bun.write(
    join(root, "scripts/release/tests/release.test.ts"),
    `import { test, expect } from "bun:test";
test("installed phase", async () => {
  expect(await Bun.file("frontend-finished").text()).toBe("yes");
  expect(await Bun.file(process.env.RUKIE_RELEASE_ARTIFACTS + "/release-build.json").text()).toBe("original fixture bytes");
  await Bun.write("release-finished", "yes");
});`,
  );
  return {
    root,
    async run(args: string[] = [], extra: Record<string, string> = {}) {
      const launched = Bun.spawn([process.execPath, "scripts/run-tests.ts", ...args], {
        cwd: root,
        env: {
          ...process.env,
          RUKIE_RELEASE_ARTIFACTS: undefined,
          RUKIE_TEST_WORKERS: "2",
          ...extra,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      child = launched;
      const [code, stdout, stderr] = await Promise.all([
        launched.exited,
        new Response(launched.stdout).text(),
        new Response(launched.stderr).text(),
      ]);
      return { code, output: stdout + stderr };
    },
    cleanup,
  };
}

test("local test entrypoint completes module, Session, frontend and installed phases and removes its original packages", async () => {
  const value = await fixture();
  const result = await value.run();
  expect(result).toMatchObject({ code: 0 });
  expect(result.output).toContain("2x PARALLEL");
  expect(await Bun.file(join(value.root, "release-finished")).text()).toBe("yes");
  const artifacts = await readFile(join(value.root, "built-path"), "utf8");
  expect(await Bun.file(join(artifacts, "release-build.json")).exists()).toBe(false);
});

test("a failed source phase stops installed acceptance and still removes owned packages", async () => {
  const value = await fixture(true);
  expect((await value.run()).code).toBe(1);
  expect(await Bun.file(join(value.root, "session-integration-finished")).exists()).toBe(false);
  expect(await Bun.file(join(value.root, "frontend-finished")).exists()).toBe(false);
  expect(await Bun.file(join(value.root, "release-finished")).exists()).toBe(false);
  const artifacts = await readFile(join(value.root, "built-path"), "utf8");
  expect(await Bun.file(join(artifacts, "release-build.json")).exists()).toBe(false);
});

test("CI artifacts and focused arguments use native Bun selection without rebuilding or removing supplied bytes", async () => {
  const value = await fixture();
  const supplied = join(value.root, "supplied");
  await Bun.write(join(supplied, "release-build.json"), "supplied original bytes");
  await Bun.write(
    join(value.root, "scripts/tests/selected.test.ts"),
    'import { expect, test } from "bun:test"; test("selected only", () => expect(true).toBe(true));',
  );
  const result = await value.run(["scripts/tests", "--shard=1/1", "-t", "selected only"], {
    RUKIE_RELEASE_ARTIFACTS: supplied,
  });
  expect(result.code).toBe(0);
  expect(result.output).toContain("selected only");
  expect(result.output).not.toContain("source phase");
  expect(await Bun.file(join(value.root, "built-path")).exists()).toBe(false);
  expect(await Bun.file(join(supplied, "release-build.json")).text()).toBe(
    "supplied original bytes",
  );
});
