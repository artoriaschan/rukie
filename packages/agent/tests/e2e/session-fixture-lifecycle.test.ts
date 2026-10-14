import { expect, onTestFinished, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.each(["Run", "initialization"])(
  "a runner-expired Session fixture settles %s before the next case owns directories",
  async (operation) => {
    let root: string | undefined;
    let preparing: Promise<unknown> | undefined;
    let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
    let output: Promise<string[]> | undefined;
    let cleanupPromise: Promise<void> | undefined;
    let closing = false;
    const cleanup = () =>
      (cleanupPromise ??= (async () => {
        closing = true;
        await preparing?.catch(() => {});
        if (child) {
          child.kill();
          await child.exited;
          await output;
        }
        if (root) await rm(root, { recursive: true, force: true });
      })());
    onTestFinished(cleanup);
    const creating = mkdtemp(join(tmpdir(), "rukie-session-owner-"));
    preparing = creating.then((path) => {
      root = path;
    });
    const fixtureRoot = await creating;
    if (closing) return;
    const path = join(fixtureRoot, "owner.test.ts");
    const helper = new URL("../helpers/owned-session.ts", import.meta.url).pathname;
    const model = new URL("../helpers/fake-model.ts", import.meta.url).pathname;
    const ai = import.meta.resolve("@earendil-works/pi-ai");
    const writing = Bun.write(
      path,
      `import { beforeEach, expect, onTestFinished, test } from "bun:test";
import { join } from "node:path";
import { watch } from "node:fs/promises";
import { ownSessionFixture } from ${JSON.stringify(helper)};
import { fakeModel } from ${JSON.stringify(model)};
import { fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(ai)};
let owner, fixture, session, request, running, initializingPid;
let next = false;
let expiredBodyResumed = false;
const secondReady = Promise.withResolvers();
beforeEach(async () => {
  if (next) return;
  next = true;
  owner = ownSessionFixture();
  fixture = await owner.initialize();
  if (${JSON.stringify(operation)} === "initialization") {
    await owner.step(() => Bun.write(join(fixture.cwd, "startup.sh"), "echo $$ > initializing.pid\\necho ready > initializing.ready\\nexec tail -f /dev/null\\n"));
    const watching = new AbortController();
    const watcher = watch(fixture.cwd, { signal: watching.signal })[Symbol.asyncIterator]();
    let changed = watcher.next();
    void changed.catch(() => {});
    onTestFinished(async () => {
      watching.abort();
      await changed.catch(() => {});
      await watcher.return();
    });
    running = owner.open({
      ...fixture,
      ...fakeModel([]),
      settings: { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "sh startup.sh" }] }] } },
    });
    while (!(await Bun.file(join(fixture.cwd, "initializing.ready")).exists())) {
      await changed;
      changed = watcher.next();
      void changed.catch(() => {});
    }
    initializingPid = Number(await Bun.file(join(fixture.cwd, "initializing.pid")).text());
    expect(initializingPid).toBeGreaterThan(0);
    process.kill(initializingPid, 0);
    return;
  }
  const asked = Promise.withResolvers();
  session = await owner.open({
    ...fixture,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: join(fixture.homeDir, "blocked.txt"), content: "bad" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]),
    permissionMode: "ask",
    onPermissionAsk: (input) => {
      request = input;
      asked.resolve();
      return new Promise(() => {});
    },
  });
  running = owner.run(session, "write");
  // The short body deadline tests cancellation of an already pending public
  // Interaction; real filesystem and Session startup finish before it begins.
  await asked.promise;
});
test("expired owner", async () => {
  try {
    await running;
  } finally {
    expiredBodyResumed = true;
    await secondReady.promise;
    await Bun.write(join(fixture.cwd, "late.txt"), "late body");
  }
}, 50);
test("next owner", async () => {
  if (initializingPid) expect(() => process.kill(initializingPid, 0)).toThrow();
  else expect(request.signal.aborted).toBe(true);
  expect(expiredBodyResumed).toBe(false);
  expect(await Bun.file(join(fixture.cwd, ".keep")).exists()).toBe(false);
  if (session) await expect(session.run("closed")).rejects.toThrow("Session is closed");
  const fresh = ownSessionFixture();
  fixture = await fresh.initialize();
  secondReady.resolve();
  const opened = await fresh.open({ ...fixture, ...fakeModel([fauxAssistantMessage("fresh")]) });
  expect((await fresh.run(opened, "continue")).text).toBe("fresh");
  expect(await Bun.file(join(fixture.cwd, "late.txt")).exists()).toBe(false);
  expect(await Bun.file(join(fixture.cwd, "blocked.txt")).exists()).toBe(false);
  await fresh.cleanup();
});
`,
    );
    preparing = writing;
    await writing;
    if (closing) return;
    // Only a real child Bun runner can impose its own body deadline and then run
    // another case. A clock in this parent cannot advance that runner or its I/O.
    child = Bun.spawn([process.execPath, "test", path], {
      cwd: fixtureRoot,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
    output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    try {
      const code = await child.exited;
      const log = (await output).join("\n");
      if (closing) return;
      expect(log).toContain("this test timed out after 50ms");
      expect(log).toContain("1 pass");
      expect(log).toContain("1 fail");
      expect(log).not.toContain("Unhandled error between tests");
      expect(log).not.toContain("ENOENT");
      expect(code).toBe(1);
    } finally {
      await cleanup();
    }
  },
);
