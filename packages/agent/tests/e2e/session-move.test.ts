import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  createSession,
  moveSession,
  withSessionMove,
  discoverSqliteSessions,
  readSessionStorage,
  type Session,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { crashUnsafeEffect } from "../helpers/native-recovery.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
  await dirs?.cleanup();
});

test("store move preserves identity and Transcript while changing cwd without running a model", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "data") };
  const target = join(dirs.homeDir, "target");
  await mkdir(target);
  session = await createSession({ ...options, ...fakeModel([fauxAssistantMessage("answer")]) });
  await session.run("old prompt");
  await session.rename("Keep title");
  const id = session.id;
  await session.close();
  session = undefined;
  await moveSession({ ...options, id, newCwd: target });
  expect(await discoverSqliteSessions(options)).toMatchObject([
    { id, cwd: target, title: "Keep title" },
  ]);
  const entries = await readSessionStorage({ ...options, cwd: target, id }, (storage) =>
    storage.scanEntries(
      { conversationId: ROOT_CONVERSATION_ID },
      100000,
      undefined,
      BACKGROUND_CONTEXT,
    ),
  );
  expect(entries.items.find((entry) => entry.kind === "rukie.session-move")).toMatchObject({
    data: { oldCwd: dirs.cwd, newCwd: target },
  });
});

test("Resume announces a move and refreshes environment once, and blocks code across its boundary", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "data") };
  const target = join(dirs.homeDir, "target");
  await mkdir(target);
  session = await createSession({ ...options, ...fakeModel([fauxAssistantMessage("old answer")]) });
  await session.run("old prompt");
  const checkpoint = session.checkpoints()[0]!;
  const id = session.id;
  await session.close();
  session = undefined;
  await moveSession({ ...options, id, newCwd: target });
  const fake = fakeModel([fauxAssistantMessage("new answer"), fauxAssistantMessage("another")]);
  session = await createSession({
    ...options,
    cwd: target,
    resumeId: id,
    additionalDirectories: [dirs.cwd],
    ...fake,
  });
  await session.run("new prompt");
  const systemUpdates = fake.contexts[0]!.messages.filter(
    (message) => message.role === "system" && message.sections?.environment,
  );
  expect(systemUpdates).toHaveLength(2);
  expect(systemUpdates[0]!.role === "system" && systemUpdates[0]!.sections!.environment).toContain(
    `cwd: ${dirs.cwd}`,
  );
  expect(systemUpdates[1]!.role === "system" && systemUpdates[1]!.sections!.environment).toContain(
    `cwd: ${target}`,
  );
  expect(systemUpdates[1]!.role === "system" && Object.keys(systemUpdates[1]!.sections!)).toEqual([
    "environment",
  ]);
  expect(JSON.stringify(fake.contexts[0])).toContain(`additional directories:\\n${dirs.cwd}`);
  expect(JSON.stringify(fake.contexts[0])).toContain(
    `Working directory changed from ${dirs.cwd} to ${target}`,
  );
  expect(
    session.messages.filter((m) => m.role === "system-reminder" && m.source === "environment"),
  ).toHaveLength(2);
  expect(
    session.messages.filter((m) => m.role === "system-reminder" && m.source === "session-move"),
  ).toHaveLength(1);
  expect(
    session.checkpoints().find((c) => c.promptEntryId === checkpoint.promptEntryId),
  ).toMatchObject({ codeRestoreBlocked: "session-moved" });
  await expect(
    session.rewind(checkpoint.promptEntryId, { code: true, conversation: true }),
  ).rejects.toMatchObject({ code: "rewind-cross-session-move" });
  await session.close();
  session = undefined;
  session = await createSession({ ...options, cwd: target, resumeId: id, ...fake });
  await session.run("another prompt");
  expect(
    session.messages.filter((m) => m.role === "system-reminder" && m.source === "session-move"),
  ).toHaveLength(1);
  await session.rewind(checkpoint.promptEntryId, { code: false, conversation: true });
  expect(session.messages.some((m) => m.role === "user")).toBe(false);
});

test("occupied, missing, cwd-mismatched and JSONL moves leave storage untouched", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "data") };
  const target = join(dirs.homeDir, "target");
  await mkdir(target);
  session = await createSession({ ...options, ...fakeModel([]) });
  const id = session.id;
  const before = await discoverSqliteSessions(options);
  await expect(moveSession({ ...options, id, newCwd: target })).rejects.toMatchObject({
    code: "session-busy",
  });
  expect(await discoverSqliteSessions(options)).toEqual(before);
  await session.close();
  session = undefined;
  const entries = () =>
    readSessionStorage({ ...options, id }, (storage) =>
      storage.scanEntries(
        { conversationId: ROOT_CONVERSATION_ID },
        100000,
        undefined,
        BACKGROUND_CONTEXT,
      ),
    );
  const persisted = await entries();
  await expect(moveSession({ ...options, id: "missing", newCwd: target })).rejects.toMatchObject({
    code: "session-not-found",
  });
  await expect(moveSession({ ...options, cwd: target, id, newCwd: target })).rejects.toMatchObject({
    code: "session-not-found",
  });
  expect(await entries()).toEqual(persisted);
  session = await createSession({ ...dirs, ...fakeModel([]) });
  const jsonlId = session.id;
  await session.close();
  session = undefined;
  await expect(moveSession({ ...dirs, id: jsonlId, newCwd: target })).rejects.toMatchObject({
    code: "session-move-unsupported",
  });
});

test("moving persisted pending work does not schedule Resume or change task records", async () => {
  dirs = await tempDirs();
  const dataRoot = join(dirs.homeDir, "data");
  const crashed = await crashUnsafeEffect(dirs.cwd, true, { dataRoot });
  const target = join(dirs.homeDir, "target");
  await mkdir(target);
  const options = { ...dirs, dataRoot, id: crashed.sessionId };
  const tasks = () =>
    readSessionStorage(options, (storage) =>
      storage.scanTasks({}, 100000, undefined, BACKGROUND_CONTEXT),
    );
  const before = await tasks();
  expect(before.items.some((task) => task.state.status === "running")).toBe(true);
  await moveSession({ ...options, newCwd: target });
  const after = await readSessionStorage({ ...options, cwd: target }, (storage) =>
    storage.scanTasks({}, 100000, undefined, BACKGROUND_CONTEXT),
  );
  expect(after).toEqual(before);
});

test("only the latest unannounced move is delivered, including a return to the original cwd", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "data") };
  const target = join(dirs.homeDir, "target");
  await mkdir(target);
  session = await createSession({ ...options, ...fakeModel([fauxAssistantMessage("old")]) });
  await session.run("old prompt");
  const id = session.id;
  await session.close();
  session = undefined;
  await moveSession({ ...options, id, newCwd: target });
  await moveSession({ ...options, cwd: target, id, newCwd: dirs.cwd });
  const fake = fakeModel([fauxAssistantMessage("back")]);
  session = await createSession({ ...options, resumeId: id, ...fake });
  await session.run("back prompt");
  expect(JSON.stringify(fake.contexts[0])).toContain(
    `Working directory changed from ${target} to ${dirs.cwd}`,
  );
  expect(
    session.messages.filter((m) => m.role === "system-reminder" && m.source === "environment"),
  ).toHaveLength(2);
  expect(
    session.messages.filter((m) => m.role === "system-reminder" && m.source === "session-move"),
  ).toHaveLength(1);
});

test("conversation Rewind retains notification progress and future moves establish a new code boundary", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "data") };
  const target = join(dirs.homeDir, "target");
  await mkdir(target);
  session = await createSession({ ...options, ...fakeModel([fauxAssistantMessage("old")]) });
  await session.run("old prompt");
  const first = session.checkpoints()[0]!;
  const id = session.id;
  await session.close();
  session = undefined;
  await moveSession({ ...options, id, newCwd: target });
  const fake = fakeModel([fauxAssistantMessage("moved"), fauxAssistantMessage("after rewind")]);
  session = await createSession({ ...options, cwd: target, resumeId: id, ...fake });
  await session.run("moved prompt");
  await session.rewind(first.promptEntryId, { code: false, conversation: true });
  await session.close();
  session = undefined;
  session = await createSession({ ...options, cwd: target, resumeId: id, ...fake });
  await session.run("replacement prompt");
  expect(
    session.messages.filter((m) => m.role === "system-reminder" && m.source === "session-move"),
  ).toHaveLength(0);
  expect(JSON.stringify(fake.contexts[1])).toContain(`cwd: ${target}`);
  const replacement = session.checkpoints()[0]!;
  expect(replacement.codeRestoreBlocked).toBeUndefined();
  await session.close();
  session = undefined;
  await moveSession({ ...options, cwd: target, id, newCwd: dirs.cwd });
  session = await createSession({
    ...options,
    resumeId: id,
    ...fakeModel([fauxAssistantMessage("returned")]),
  });
  expect(session.checkpoints()[0]).toMatchObject({
    promptEntryId: replacement.promptEntryId,
    codeRestoreBlocked: "session-moved",
  });
  await expect(
    session.rewind(replacement.promptEntryId, { code: true, conversation: false }),
  ).rejects.toMatchObject({ code: "rewind-cross-session-move" });
  await session.run("returned prompt");
  expect(
    session.messages.filter((m) => m.role === "system-reminder" && m.source === "session-move"),
  ).toHaveLength(1);
});

test("Session Move reservation excludes other frontends through host work and binding publication", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "data") };
  const target = join(dirs.homeDir, "target");
  await mkdir(target);
  session = await createSession({ ...options, ...fakeModel([fauxAssistantMessage("done")]) });
  await session.run("preserve history");
  const id = session.id;
  await session.close();
  session = undefined;
  const contender = (cwd: string) =>
    createSession({ ...options, cwd, resumeId: id, ...fakeModel([]) });
  await withSessionMove({ ...options, id, newCwd: target }, async (move) => {
    await expect(contender(dirs.cwd)).rejects.toMatchObject({ code: "session-busy" });
    await move();
    await expect(contender(target)).rejects.toMatchObject({ code: "session-busy" });
  });
  session = await contender(target);
  expect(await discoverSqliteSessions(options)).toContainEqual(
    expect.objectContaining({ id, cwd: target }),
  );
  expect(session.messages.some((message) => message.role === "user")).toBe(true);
  await session.close();
  session = undefined;
  await expect(
    withSessionMove({ ...options, cwd: target, id, newCwd: dirs.cwd }, async () => {
      throw new Error("Host operation failed");
    }),
  ).rejects.toThrow("Host operation failed");
  session = await contender(target);
  expect(await discoverSqliteSessions(options)).toContainEqual(
    expect.objectContaining({ id, cwd: target }),
  );
});
