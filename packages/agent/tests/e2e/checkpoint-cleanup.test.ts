import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { access, chmod, symlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { createSession, type Session } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
  await dirs?.cleanup();
});

test("startup removes expired session backups and keeps recent directories and the 30-day boundary", async () => {
  dirs = await tempDirs();
  const history = join(dirs.homeDir, ".neant", "file-history");
  const now = new Date("2026-10-05T00:00:00Z");
  for (const [id, modified] of [
    ["expired", "2026-09-04T23:59:59Z"],
    ["boundary", "2026-09-05T00:00:00Z"],
    ["recent", "2026-10-04T00:00:00Z"],
  ] as const) {
    await Bun.write(join(history, id, "backup"), id);
    await utimes(join(history, id), new Date(modified), new Date(modified));
  }
  const warnings: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([]),
    now: () => now,
    onWarning: (warning) => warnings.push(warning),
  });
  sessions.push(session);
  await expect(access(join(history, "expired"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await Bun.file(join(history, "boundary", "backup")).text()).toBe("boundary");
  expect(await Bun.file(join(history, "recent", "backup")).text()).toBe("recent");
  expect(warnings).toEqual([]);
});

test("resuming an expired Session preserves its backups and can still rewind its files", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "original");
  const original = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "changed" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]),
    permissionMode: "full-access",
    onWarning() {},
  });
  sessions.push(original);
  await original.run("change file");
  const history = join(dirs.homeDir, ".neant", "file-history");
  const old = new Date("2026-08-01T00:00:00Z");
  await utimes(join(history, original.id), old, old);
  await Bun.write(join(history, "other-expired", "backup"), "expired");
  await utimes(join(history, "other-expired"), old, old);
  const warnings: string[] = [];
  const resumed = await createSession({
    ...dirs,
    ...fakeModel([]),
    resumeId: original.id,
    now: () => new Date("2026-10-05T00:00:00Z"),
    onWarning: (warning) => warnings.push(warning),
  });
  sessions.push(resumed);
  await expect(access(join(history, "other-expired"))).rejects.toMatchObject({ code: "ENOENT" });
  await resumed.rewind(resumed.checkpoints()[0]!.promptEntryId, {
    code: true,
    conversation: false,
  });
  expect(await Bun.file(join(dirs.cwd, "file.txt")).text()).toBe("original");
  expect(warnings).toEqual([]);
});

test("a missing backup directory emits a warning and the Session can still run", async () => {
  dirs = await tempDirs({ fileHistory: false });
  const warnings: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("ready")]),
    onWarning: (warning) => warnings.push(warning),
  });
  sessions.push(session);
  expect(warnings).toEqual([
    expect.stringContaining(
      `Checkpoint backup cleanup failed for ${join(dirs.homeDir, ".neant", "file-history")}`,
    ),
  ]);
  await session.run("hello");
  expect(session.messages.at(-1)).toMatchObject({ role: "assistant" });
});

test("a failed deletion warns without preventing startup or cleanup of other expired backups", async () => {
  dirs = await tempDirs();
  const history = join(dirs.homeDir, ".neant", "file-history");
  const blocked = join(history, "a-blocked");
  const old = new Date("2026-08-01T00:00:00Z");
  await Bun.write(join(blocked, "backup"), "keep");
  await Bun.write(join(history, "b-expired", "backup"), "expired");
  await utimes(blocked, old, old);
  await utimes(join(history, "b-expired"), old, old);
  await chmod(blocked, 0o500);
  try {
    const warnings: string[] = [];
    const session = await createSession({
      ...dirs,
      ...fakeModel([fauxAssistantMessage("ready")]),
      now: () => new Date("2026-10-05T00:00:00Z"),
      onWarning: (warning) => warnings.push(warning),
    });
    sessions.push(session);
    expect(warnings).toEqual([
      expect.stringContaining(`Checkpoint backup cleanup failed for ${blocked}`),
    ]);
    expect(await Bun.file(join(blocked, "backup")).text()).toBe("keep");
    await expect(access(join(history, "b-expired"))).rejects.toMatchObject({ code: "ENOENT" });
    await session.run("hello");
    expect(session.messages.at(-1)).toMatchObject({ role: "assistant" });
  } finally {
    await chmod(blocked, 0o700);
  }
});

test("startup leaves non-directory entries and linked directories untouched", async () => {
  dirs = await tempDirs();
  const history = join(dirs.homeDir, ".neant", "file-history");
  await Bun.write(join(history, "stray-file"), "keep file");
  const old = new Date("2026-08-01T00:00:00Z");
  await utimes(join(history, "stray-file"), old, old);
  await Bun.write(join(dirs.cwd, "linked", "backup"), "keep linked backup");
  await utimes(join(dirs.cwd, "linked"), old, old);
  await symlink(join(dirs.cwd, "linked"), join(history, "linked-session"));
  const warnings: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([]),
    now: () => new Date("2026-10-05T00:00:00Z"),
    onWarning: (warning) => warnings.push(warning),
  });
  sessions.push(session);
  expect(await Bun.file(join(history, "stray-file")).text()).toBe("keep file");
  expect(await Bun.file(join(history, "linked-session", "backup")).text()).toBe(
    "keep linked backup",
  );
  expect(warnings).toEqual([]);
});
