import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { mkdir, readdir, rm, stat, symlink, rename } from "node:fs/promises";
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
  deleteSession,
  isSqliteSessionBusy,
  renameSessionTitle,
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

test("desktop attachments survive native read-only history and resume while orphan files are cleaned", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=";
  const fake = fakeModel([fauxAssistantMessage("seen")]);
  session = await createSession({ ...options, ...fake });
  await session.run("inspect", {
    images: [{ data: png, mimeType: "image/png", name: "saved.png" }],
  });
  const id = session.id;
  const attachmentDirectory = join(options.dataRoot, "attachments", id);
  expect((await readdir(attachmentDirectory)).length).toBe(1);
  expect(JSON.stringify(fake.contexts[0]!.messages)).toContain(png);
  await Bun.write(join(attachmentDirectory, "orphan"), "uncommitted");
  await session.close();
  session = undefined;
  expect((await readdir(attachmentDirectory)).length).toBe(1);
  const snapshot = await readSessionSnapshot({ ...options, id });
  expect(JSON.stringify(snapshot)).toContain(png);
  expect(JSON.stringify(snapshot)).toContain("saved.png");
  const next = fakeModel([fauxAssistantMessage("again")]);
  session = await createSession({ ...options, ...next, resumeId: id });
  await session.run("continue");
  expect(JSON.stringify(next.contexts[0]!.messages)).toContain(png);
});

test("desktop Goal attachments roundtrip without inline image bytes in native task storage", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=";
  const fake = fakeModel([fauxAssistantMessage("target seen")]);
  session = await createSession({ ...options, ...fake, permissionMode: "full-access" });
  const accepted = await session.createGoal("", {
    images: [{ data: png, mimeType: "image/png", name: "target.png" }],
    maxRounds: 1,
  });
  await session.waitForRequest(accepted.requestId);
  const id = session.id;
  await session.close();
  session = undefined;
  const database = await Bun.file(join(options.dataRoot, "sessions", id, "session.sqlite")).bytes();
  expect(Buffer.from(database).includes(Buffer.from(png))).toBe(false);
  expect((await readdir(join(options.dataRoot, "attachments", id))).length).toBe(1);
  const snapshot = await readSessionSnapshot({ ...options, id });
  expect(JSON.stringify(snapshot)).toContain(png);
  expect(JSON.stringify(snapshot)).toContain("target.png");
  const next = fakeModel([fauxAssistantMessage("restored target seen")]);
  session = await createSession({ ...options, ...next, resumeId: id });
  await session.run("inspect saved target");
  expect(JSON.stringify(next.contexts[0]!.messages)).toContain(png);
});

test("desktop rewind keeps abandoned branch backups and reclaims only unreferenced files repeatedly", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  await Bun.write(join(dirs.cwd, "file.txt"), "original");
  session = await createSession({
    ...options,
    permissionMode: "full-access",
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "changed" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]),
  });
  await session.run("change");
  const id = session.id;
  const checkpoint = session.checkpoints()[0]!;
  const reference = checkpoint.files[0]!.backup!;
  expect(reference).toStartWith(`file-history/${id}/`);
  await session.rewind(checkpoint.promptEntryId, { code: true, conversation: true });
  expect(await Bun.file(join(dirs.cwd, "file.txt")).text()).toBe("original");
  const directory = join(options.dataRoot, "file-history", id);
  await Bun.write(join(directory, "orphan"), "failed write");
  await session.close();
  session = undefined;
  expect(await Bun.file(join(options.dataRoot, reference)).text()).toBe("original");
  expect(await Bun.file(join(directory, "orphan")).exists()).toBe(false);
  session = await createSession({ ...options, ...fakeModel([]), resumeId: id });
  await session.close();
  session = undefined;
  expect(await Bun.file(join(options.dataRoot, reference)).text()).toBe("original");
});

test("desktop attachment write refuses a symlink escape before submitting or invoking a model", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  const fake = fakeModel([fauxAssistantMessage("must not run")]);
  session = await createSession({ ...options, ...fake });
  const root = join(options.dataRoot, "attachments");
  await mkdir(root, { recursive: true });
  const link = join(root, session.id);
  await symlink(dirs.cwd, link);
  try {
    await expect(
      session.run("escape", {
        images: [
          {
            data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
            mimeType: "image/gif",
          },
        ],
      }),
    ).rejects.toThrow("escapes");
    expect(fake.contexts).toHaveLength(0);
    expect(await readdir(dirs.cwd)).toEqual([".keep"]);
  } finally {
    await rm(link);
  }
});

test("permanent deletion removes the root Session, child storage and external files", async () => {
  dirs = await tempDirs();
  const dataRoot = join(dirs.homeDir, "desktop-data");
  const crashed = await crashUnsafeEffect(dirs.cwd, true, { dataRoot });
  const options = { cwd: dirs.cwd, homeDir: dirs.cwd, dataRoot };
  expect(crashed.childId).toBeString();
  expect(
    JSON.stringify(await readSessionSnapshot({ ...options, id: crashed.sessionId })),
  ).toContain("Unknown child");
  for (const kind of ["attachments", "file-history"]) {
    await mkdir(join(dataRoot, kind, crashed.sessionId), { recursive: true });
    await Bun.write(join(dataRoot, kind, crashed.sessionId, "owned"), "bytes");
  }
  await deleteSession({ ...options, id: crashed.sessionId });
  expect(await listSessions(options)).toEqual([]);
  expect(await discoverSqliteSessions(options)).toEqual([]);
  for (const kind of ["sessions", "attachments", "file-history"])
    expect(await readdir(join(dataRoot, kind))).not.toContain(crashed.sessionId);
  for (const directory of ["sessions", "attachments", "file-history"])
    expect(
      await Bun.file(
        join(
          dataRoot,
          directory,
          crashed.sessionId,
          directory === "sessions" ? "session.sqlite" : "owned",
        ),
      ).exists(),
    ).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "uncertain-effect.txt")).text()).toBe("saved effect");
  await expect(
    createSession({ ...options, resumeId: crashed.sessionId, ...fakeModel([]) }),
  ).rejects.toMatchObject({ code: "session-not-found" });
});

test("permanent deletion rejects an occupied lease without removing any Session files", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  session = await createSession({ ...options, ...fakeModel([]) });
  const id = session.id;
  await mkdir(join(options.dataRoot, "file-history", id), { recursive: true });
  await Bun.write(join(options.dataRoot, "file-history", id, "kept"), "history");
  const storage = join(options.dataRoot, "sessions", id, "session.sqlite");
  const before = await Bun.file(storage).bytes();
  await expect(deleteSession({ ...options, id })).rejects.toMatchObject({ code: "session-busy" });
  expect(await Bun.file(storage).bytes()).toEqual(before);
  expect(await Bun.file(join(options.dataRoot, "file-history", id, "kept")).text()).toBe("history");
  const alias = join(dirs.homeDir, "desktop-alias");
  await symlink(options.dataRoot, alias, "dir");
  await expect(deleteSession({ ...options, dataRoot: alias, id })).rejects.toMatchObject({
    code: "session-busy",
  });
  expect(isSqliteSessionBusy({ ...options, dataRoot: alias, id })).toBe(true);
  await expect(
    renameSessionTitle({ ...options, dataRoot: alias, id, title: "Rejected alias" }),
  ).rejects.toMatchObject({ code: "session-busy" });
  await expect(
    createSession({ ...options, dataRoot: alias, resumeId: id, ...fakeModel([]) }),
  ).rejects.toMatchObject({ code: "session-busy" });
  await session.close();
  session = undefined;
  expect(isSqliteSessionBusy({ ...options, dataRoot: alias, id })).toBe(false);
  expect((await listSessions(options)).map((item) => item.id)).toEqual([id]);
});

test("permanent deletion validates every target before deleting and never follows symlink parents", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  session = await createSession({ ...options, ...fakeModel([]) });
  const id = session.id;
  await session.close();
  session = undefined;
  const outside = join(dirs.cwd, "outside-history");
  await mkdir(outside);
  await mkdir(join(outside, id));
  await Bun.write(join(outside, id, "precious"), "outside");
  await symlink(outside, join(options.dataRoot, "file-history"), "dir");
  await expect(deleteSession({ ...options, id })).rejects.toThrow("symlink");
  expect((await listSessions(options)).map((item) => item.id)).toEqual([id]);
  expect(await Bun.file(join(outside, id, "precious")).text()).toBe("outside");
  await rm(join(options.dataRoot, "file-history"));
  const missing = join(dirs.cwd, "missing-history");
  await symlink(missing, join(options.dataRoot, "file-history"), "dir");
  await expect(deleteSession({ ...options, id })).rejects.toThrow("symlink");
  expect((await listSessions(options)).map((item) => item.id)).toEqual([id]);
  expect(await Bun.file(missing).exists()).toBe(false);
  await expect(deleteSession({ ...options, id: "../outside-history" })).rejects.toMatchObject({
    code: "session-not-found",
  });
});

test("writer leases reject redirected Session parents instead of creating a second lock identity", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  session = await createSession({ ...options, ...fakeModel([]) });
  const id = session.id;
  await session.close();
  session = undefined;
  const outside = join(dirs.cwd, "redirected-sessions");
  await rename(join(options.dataRoot, "sessions"), outside);
  await symlink(outside, join(options.dataRoot, "sessions"), "dir");
  const path = join(outside, id, "session.sqlite");
  const before = await Bun.file(path).bytes();
  const fake = fakeModel([]);
  const opening = createSession({ ...options, ...fake, resumeId: id });
  void opening.then(
    (owner) => {
      session = owner;
    },
    () => {},
  );
  await expect(opening).rejects.toThrow("symlink");
  await expect(renameSessionTitle({ ...options, id, title: "Unsafe" })).rejects.toThrow("symlink");
  expect(() => isSqliteSessionBusy({ ...options, id })).toThrow("symlink");
  await expect(deleteSession({ ...options, id })).rejects.toThrow("symlink");
  expect(fake.contexts).toEqual([]);
  expect(await Bun.file(path).bytes()).toEqual(before);
});

test("writer leases reject redirected coordination files and storage files for every lease consumer", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  session = await createSession({ ...options, ...fakeModel([]) });
  const id = session.id;
  await session.close();
  session = undefined;
  const coordination = join(options.dataRoot, ".session-leases");
  const mutexName = (await readdir(coordination)).find((name) => name.endsWith(".sqlite"));
  if (!mutexName) throw new Error("Missing stable coordination file");
  const storage = join(options.dataRoot, "sessions", id, "session.sqlite");
  const outside = join(dirs.cwd, "redirected");
  await mkdir(outside);
  for (const target of [coordination, join(coordination, mutexName), storage]) {
    const moved = join(outside, "moved");
    await rename(target, moved);
    await symlink(moved, target);
    const fake = fakeModel([]);
    const opening = createSession({ ...options, ...fake, resumeId: id });
    try {
      void opening.then(
        (owner) => {
          session = owner;
        },
        () => {},
      );
      await expect(opening).rejects.toThrow("symlink");
      await expect(renameSessionTitle({ ...options, id, title: "Unsafe" })).rejects.toThrow(
        "symlink",
      );
      expect(() => isSqliteSessionBusy({ ...options, id })).toThrow("symlink");
      await expect(deleteSession({ ...options, id })).rejects.toThrow("symlink");
      expect(fake.contexts).toEqual([]);
      expect(await Bun.file(storage).exists()).toBe(true);
    } finally {
      await (await opening.catch(() => undefined))?.close();
      session = undefined;
      await rm(target);
      await rename(moved, target);
    }
  }
  const mutex = join(coordination, mutexName);
  const saved = join(outside, "saved-mutex");
  const missing = join(outside, "must-not-create.sqlite");
  await rename(mutex, saved);
  await symlink(missing, mutex);
  try {
    await expect(
      renameSessionTitle({ ...options, id, title: "Unsafe dangling lease" }),
    ).rejects.toThrow("symlink");
    await expect(deleteSession({ ...options, id })).rejects.toThrow("symlink");
    expect(() => isSqliteSessionBusy({ ...options, id })).toThrow("symlink");
    expect(await Bun.file(missing).exists()).toBe(false);
  } finally {
    await rm(mutex);
    await rename(saved, mutex);
  }
});
