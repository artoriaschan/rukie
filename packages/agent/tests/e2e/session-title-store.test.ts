import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { join } from "node:path";
import {
  createSession,
  listSessions,
  readSessionStorage,
  renameSessionTitle,
  type Session,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { crashUnsafeEffect } from "../helpers/native-recovery.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
  await dirs?.cleanup();
});

test("title-only store rename persists user ownership through read-only listing and Resume", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  session = await createSession({ ...options, ...fakeModel([]) });
  const id = session.id;
  await session.close();
  session = undefined;
  await renameSessionTitle({ ...options, id, title: "  \x1b[31mMy\x1b[0m   chat\n  " });
  expect(await listSessions(options)).toMatchObject([
    { id, title: "My chat", titleSource: "user", messageCount: 0 },
  ]);
  const fake = fakeModel([fauxAssistantMessage("answer")]);
  session = await createSession({ ...options, resumeId: id, ...fake });
  expect(session.title).toBe("My chat");
  expect(session.toolState("title-source")).toBe("user");
  await session.run("first prompt after renaming");
  expect(session.title).toBe("My chat");
  expect(fake.contexts).toHaveLength(1);
  expect(await listSessions(options)).toMatchObject([{ title: "My chat", titleSource: "user" }]);
});

test("title-only store rename leaves an occupied Session untouched and rejects invalid input", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  session = await createSession({ ...options, ...fakeModel([]) });
  await session.rename("Original");
  const id = session.id;
  await expect(renameSessionTitle({ ...options, id, title: "Replacement" })).rejects.toMatchObject({
    code: "session-busy",
  });
  expect(await listSessions(options)).toMatchObject([{ title: "Original", titleSource: "user" }]);
  await session.close();
  session = undefined;
  await expect(renameSessionTitle({ ...options, id, title: " \n " })).rejects.toMatchObject({
    code: "session-title-empty",
  });
  await expect(
    renameSessionTitle({ ...options, id: "missing", title: "Replacement" }),
  ).rejects.toMatchObject({ code: "session-not-found" });
  expect(await listSessions(options)).toMatchObject([{ id, title: "Original" }]);
  await renameSessionTitle({ ...options, id, title: "Replacement" });
  expect(await listSessions(options)).toMatchObject([{ id, title: "Replacement" }]);
});

test("title-only store rename leaves persisted pending work unscheduled", async () => {
  dirs = await tempDirs();
  const dataRoot = join(dirs.homeDir, "desktop-data");
  const crashed = await crashUnsafeEffect(dirs.cwd, true, { dataRoot });
  const options = { ...dirs, dataRoot, id: crashed.sessionId };
  const tasks = () =>
    readSessionStorage(options, (storage) =>
      storage.scanTasks({}, 100000, undefined, BACKGROUND_CONTEXT),
    );
  const pending = await tasks();
  expect(pending.items.some((task) => task.state.status === "running")).toBe(true);
  await renameSessionTitle({ ...options, title: "Keep my pending work" });
  expect(await tasks()).toEqual(pending);
  expect(await listSessions(options)).toMatchObject([
    { title: "Keep my pending work", titleSource: "user" },
  ]);
});
