import { expect, onTestFinished, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWithClock } from "../helpers/clock-app";

// The timeout belongs to a separate Bun runner. A parent virtual clock cannot
// verify that runner's timeout hooks, next-test admission, or resource release.
// Prepare in beforeEach, then time out an already-suspended body in 1ms. The
// deliberately failing deadline imposes no startup-speed requirement.
test.each(["suspended", "terminal", "setup"] as const)(
  "runner timeout closes %s waits and restores the app clock before the next test",
  async (waiting) => {
    const root = await mkdtemp(join(tmpdir(), "rukie-test-lifecycle-"));
    const fixture = join(root, "timeout.test.ts");
    const helper = new URL("../helpers/clock-app.ts", import.meta.url).pathname;
    const marker = join(root, "owner-root");
    let runner: ReturnType<typeof Bun.spawn> | undefined;
    let finished = false;
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () =>
      (cleanupPromise ??= (async () => {
        finished = true;
        try {
          runner?.kill();
          await runner?.exited;
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      })());
    onTestFinished(cleanup);
    try {
      await writeFile(
        fixture,
        `
import { beforeEach, test, expect } from "bun:test";
import { startWithClock } from ${JSON.stringify(helper)};
const realDate = Date;
const realTimeout = setTimeout;
const resume = Promise.withResolvers<void>();
const unwound = Promise.withResolvers<void>();
const setupEntered = Promise.withResolvers<void>();
const releaseSetup = Promise.withResolvers<void>();
let starting: Promise<Awaited<ReturnType<typeof startWithClock>>>;
let owner: Awaited<ReturnType<typeof startWithClock>>;
let prepared = false;
let entered = false;
beforeEach(async () => {
  if (prepared) return;
  prepared = true;
  ${
    waiting === "setup"
      ? `starting = startWithClock(["launch"], {
    async prepare(root) {
      await Bun.write(${JSON.stringify(marker)}, root);
      setupEntered.resolve();
      await releaseSetup.promise;
    },
  });
  await setupEntered.promise;`
      : `owner = await startWithClock(["launch"]);
  await owner.waitFor(() => owner.calls.length === 1);
  await Bun.write(${JSON.stringify(marker)}, owner.root);`
  }
});
test("timed out owner", async () => {
  entered = true;
  ${
    waiting === "setup"
      ? "await starting;"
      : `const app = owner;
  try { await ${waiting === "terminal" ? "app.waitFor(() => false)" : "resume.promise"}; }
  finally { await app.cleanup(); unwound.resolve(); }`
  }
}, 1);
test("next owner", async () => {
  expect(entered).toBe(true);
  expect(Date).toBe(realDate);
  expect(setTimeout).toBe(realTimeout);
  const app = await startWithClock();
  try {
    const ownedDate = Date;
    const ownedNow = Date.now();
    ${waiting === "setup" ? "releaseSetup.resolve();" : "resume.resolve();"}
    await ${waiting === "suspended" ? "unwound.promise" : "app.flush()"};
    expect(Date).toBe(ownedDate);
    expect(Date.now()).toBe(ownedNow);
    await app.waitFor(() => app.screen().some(row => row.includes("❯")));
  } finally { await app.cleanup(); }
});
`,
      );
      const activeRunner = (runner = Bun.spawn([process.execPath, "test", fixture], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, FORCE_COLOR: "0" },
      }));
      const [code, stdout, stderr] = await Promise.all([
        activeRunner.exited,
        new Response(activeRunner.stdout).text(),
        new Response(activeRunner.stderr).text(),
      ]);
      // A timed-out parent must not continue asserting after runner-owned teardown.
      if (finished) return new Promise<never>(() => {});
      const output = stdout + stderr;
      expect(code).toBe(1);
      expect(output).toContain("this test timed out after 1ms");
      expect(output).toContain("(pass) next owner");
      expect(output).toContain("1 pass");
      expect(output).toContain("1 fail");
      expect(output).not.toContain("A virtual clock is already active");
      expect(output).not.toContain("error between tests");
      const ownedRoot = await Bun.file(marker).text();
      expect(
        await access(ownedRoot).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
    } finally {
      await cleanup();
    }
  },
);

test("failed app preparation releases its directory", async () => {
  const realDate = Date;
  const realTimeout = setTimeout;
  let ownedRoot = "";
  await expect(
    startWithClock([], {
      async prepare(root) {
        ownedRoot = root;
        throw new Error("fixture preparation failed");
      },
    }),
  ).rejects.toThrow("fixture preparation failed");
  expect(Date).toBe(realDate);
  expect(setTimeout).toBe(realTimeout);
  expect(ownedRoot).not.toBe("");
  expect(
    await access(ownedRoot).then(
      () => true,
      () => false,
    ),
  ).toBe(false);
});
