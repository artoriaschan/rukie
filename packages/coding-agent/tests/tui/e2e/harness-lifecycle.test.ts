import { expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWithClock } from "../helpers/clock-app";

// The timeout belongs to a separate Bun runner. A parent virtual clock cannot
// verify that runner's timeout hooks, next-test admission, or resource release.
test.each(["suspended", "terminal"] as const)(
  "runner timeout closes %s waits and restores the app clock before the next test",
  async (waiting) => {
    const root = await mkdtemp(join(tmpdir(), "rukie-test-lifecycle-"));
    const fixture = join(root, "timeout.test.ts");
    const helper = new URL("../helpers/clock-app.ts", import.meta.url).pathname;
    const marker = join(root, "owner-root");
    await writeFile(
      fixture,
      `
import { test, expect } from "bun:test";
import { startWithClock } from ${JSON.stringify(helper)};
const realDate = Date;
const realTimeout = setTimeout;
const resume = Promise.withResolvers<void>();
const unwound = Promise.withResolvers<void>();
test("timed out owner", async () => {
  const app = await startWithClock(["launch"]);
  await app.waitFor(() => app.calls.length === 1);
  await Bun.write(${JSON.stringify(marker)}, app.root);
  try { await ${waiting === "terminal" ? "app.waitFor(() => false)" : "resume.promise"}; }
  finally { await app.cleanup(); unwound.resolve(); }
}, 1000);
test("next owner", async () => {
  expect(Date).toBe(realDate);
  expect(setTimeout).toBe(realTimeout);
  const app = await startWithClock();
  try {
    const ownedDate = Date;
    const ownedNow = Date.now();
    resume.resolve();
    await ${waiting === "suspended" ? "unwound.promise" : "app.flush()"};
    expect(Date).toBe(ownedDate);
    expect(Date.now()).toBe(ownedNow);
    await app.waitFor(() => app.screen().some(row => row.includes("❯")));
  } finally { await app.cleanup(); }
});
`,
    );
    const runner = Bun.spawn([process.execPath, "test", fixture], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    try {
      const [code, stdout, stderr] = await Promise.all([
        runner.exited,
        new Response(runner.stdout).text(),
        new Response(runner.stderr).text(),
      ]);
      const output = stdout + stderr;
      expect(code).toBe(1);
      expect(output).toContain("this test timed out after 1000ms");
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
      runner.kill();
      await runner.exited;
      await rm(root, { recursive: true, force: true });
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
