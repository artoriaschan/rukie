import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { readdir, stat } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession as createKernel } from "@earendil-works/pi-durable";
import { SessionMetadataDoc } from "../../src/store/index.ts";
import { crashUnsafeEffect } from "../helpers/native-recovery.ts";
import { readSessionStorage } from "../../src/index.ts";
import { join } from "node:path";
import {
  createSession,
  discoverSqliteSessions,
  listSessions,
  readSessionSnapshot,
  type Session,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
  await dirs?.cleanup();
});

test("desktop Session persists a native SQLite Harness and reopens its committed history", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  session = await createSession({
    ...options,
    ...fakeModel([fauxAssistantMessage("saved answer")]),
  });
  await session.run("saved question");
  const id = session.id;
  expect(await Bun.file(join(options.dataRoot, "sessions", id, "session.sqlite")).exists()).toBe(
    true,
  );
  await session.close();
  session = undefined;
  expect((await listSessions(options)).map((item) => item.id)).toEqual([id]);
  expect(await listSessions({ ...options, cwd: dirs.homeDir })).toEqual([]);
  expect(await discoverSqliteSessions(options)).toMatchObject([{ id, cwd: dirs.cwd }]);
  await expect(
    createSession({ ...options, cwd: dirs.homeDir, resumeId: id, ...fakeModel([]) }),
  ).rejects.toMatchObject({ code: "session-not-found" });
  expect(JSON.stringify(await readSessionSnapshot({ ...options, id }))).toContain("saved answer");
  session = await createSession({
    ...options,
    resumeId: id,
    ...fakeModel([fauxAssistantMessage("new answer")]),
  });
  expect(JSON.stringify(session.messages)).toContain("saved answer");
  await session.run("next question");
  expect(JSON.stringify(session.messages)).toContain("new answer");
});

test("busy desktop read callback holds one committed frame while its owner commits", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  session = await createSession({ ...options, ...fakeModel([]) });
  await session.rename("before read");
  const owner = session;
  await readSessionStorage({ ...options, id: owner.id }, async (storage) => {
    const kernel = createKernel(storage);
    const before = await kernel.snapshot(SessionMetadataDoc, BACKGROUND_CONTEXT);
    await owner.rename("after read");
    expect(await kernel.snapshot(SessionMetadataDoc, BACKGROUND_CONTEXT)).toEqual(before);
    await expect(storage.mintId()).rejects.toThrow("read-only");
    await expect(storage.commit([], BACKGROUND_CONTEXT)).rejects.toThrow("read-only");
  });
  expect((await listSessions(options))[0]?.title).toBe("after read");
});

test("read-only SQLite refuses missing, incompatible or malformed storage without migration or repair", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  await expect(readSessionSnapshot({ ...options, id: "missing" })).rejects.toMatchObject({
    code: "session-not-found",
  });
  expect(await Bun.file(join(options.dataRoot, "sessions/missing/session.sqlite")).exists()).toBe(
    false,
  );
  session = await createSession({ ...options, ...fakeModel([]) });
  const id = session.id;
  await session.close();
  session = undefined;
  const path = join(options.dataRoot, "sessions", id, "session.sqlite");
  const db = new Database(path);
  db.exec("UPDATE durable_schema SET version = 0");
  db.close();
  const bytes = await Bun.file(path).bytes();
  await expect(readSessionSnapshot({ ...options, id })).rejects.toThrow(
    "Unsupported read-only Session schema",
  );
  expect(await Bun.file(path).bytes()).toEqual(bytes);
  const invalid = new Database(path);
  invalid.exec("UPDATE durable_schema SET version = 1; UPDATE durable_metadata SET next_seq = 0");
  invalid.close();
  const invalidBytes = await Bun.file(path).bytes();
  await expect(readSessionSnapshot({ ...options, id })).rejects.toThrow(
    "Invalid durable SQLite metadata",
  );
  expect(await Bun.file(path).bytes()).toEqual(invalidBytes);
  await Bun.write(path, "not a SQLite database");
  await expect(readSessionSnapshot({ ...options, id })).rejects.toThrow();
  expect(await Bun.file(path).text()).toBe("not a SQLite database");
});

test("SQLite root Harness retains child ownership after a real process crash without replaying unsafe effects", async () => {
  dirs = await tempDirs();
  const dataRoot = join(dirs.homeDir, "desktop-data");
  const crashed = await crashUnsafeEffect(dirs.cwd, true, { dataRoot });
  const options = { cwd: dirs.cwd, homeDir: dirs.cwd, dataRoot };
  const path = join(dataRoot, "sessions", crashed.sessionId, "session.sqlite");
  const bytes = await Bun.file(path).bytes();
  const wal = await Bun.file(path + "-wal").bytes();
  expect((await listSessions(options)).map((item) => item.id)).toEqual([crashed.sessionId]);
  expect(
    JSON.stringify(await readSessionSnapshot({ ...options, id: crashed.sessionId })),
  ).toContain("Unknown child");
  expect(await Bun.file(path).bytes()).toEqual(bytes);
  expect(await Bun.file(path + "-wal").bytes()).toEqual(wal);
  expect(await readdir(join(dataRoot, "sessions"))).toEqual([crashed.sessionId]);
  session = await createSession({
    ...options,
    resumeId: crashed.sessionId,
    permissionMode: "full-access",
    ...fakeModel(Array.from({ length: 8 }, () => fauxAssistantMessage("recovered work"))),
  });
  expect(session.currentRequestId).toBeDefined();
  await session.waitForRequest(session.currentRequestId!);
  if (!crashed.childId) throw new Error("Expected child identity");
  const child = await session.readSubagent(crashed.childId);
  expect(child?.messages.filter((message) => message.role === "toolResult")).toMatchObject([
    { toolName: "write", isError: true, outcomeUnknown: true },
  ]);
  expect(session.toolState("subagents")).toMatchObject([{ id: crashed.childId, active: false }]);
  await session.close();
  session = undefined;
  expect(await Bun.file(join(dirs.cwd, "uncertain-effect.txt")).text()).toBe("saved effect");
  expect((await stat(join(dirs.cwd, "uncertain-effect.txt"))).mtimeMs).toBe(
    crashed.effectModifiedAt,
  );
  const db = new Database(path);
  expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
  db.close();
});
