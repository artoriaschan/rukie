import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type Session } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
const originalTZ = process.env.TZ;
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  await dirs?.cleanup();
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});
const timeReminders = (session: Session) =>
  session.messages.filter((m) => m.role === "system-reminder" && m.source === "time");
async function open(now: () => Date, replies = 1, resumeId?: string) {
  const fake = fakeModel(Array.from({ length: replies }, () => fauxAssistantMessage("done")));
  const session = await createSession({ ...dirs, ...fake, now, resumeId });
  sessions.push(session);
  return session;
}

test("opening time snapshot includes local weekday, second, IANA zone and UTC offset", async () => {
  process.env.TZ = "Asia/Shanghai";
  dirs = await tempDirs();
  const session = await open(() => new Date("2026-10-01T12:34:56Z"));
  await session.run("hello");
  expect(timeReminders(session)).toMatchObject([
    {
      content:
        "Current time: 2026-10-01 Thursday 20:34:56 (system time zone Asia/Shanghai, UTC+08:00). This snapshot does not update automatically.",
      timestamp: 1790858096000,
    },
  ]);
  expect(session.messages.find((m) => m.role === "user")?.timestamp).toBe(1790858096000);
  expect(session.messages.find((m) => m.role === "assistant")?.timestamp).toBe(1790858096000);
});

test("recent conversation activity suppresses refresh until exactly two idle hours", async () => {
  process.env.TZ = "Asia/Shanghai";
  dirs = await tempDirs();
  let now = new Date("2026-10-01T12:00:00Z");
  const session = await open(() => now, 4);
  await session.run("first");
  now = new Date("2026-10-01T13:59:59Z");
  await session.run("before threshold");
  expect(timeReminders(session)).toHaveLength(1);
  now = new Date("2026-10-01T15:59:58Z");
  await session.run("recent assistant activity");
  expect(timeReminders(session)).toHaveLength(1);
  now = new Date("2026-10-01T17:59:58Z");
  await session.run("at threshold");
  expect(timeReminders(session)).toHaveLength(2);
  expect(timeReminders(session).at(-1)).toMatchObject({
    content:
      "Conversation idle for 7200 seconds. Current time: 2026-10-02 Friday 01:59:58 (system time zone Asia/Shanghai, UTC+08:00). Do not mention the date change to the user.",
  });
});

test("local midnight refreshes within two hours and Resume uses historical activity", async () => {
  process.env.TZ = "Asia/Shanghai";
  dirs = await tempDirs();
  let now = new Date("2026-10-01T15:59:59Z");
  const session = await open(() => now, 2);
  await session.run("first");
  now = new Date("2026-10-01T16:00:00Z");
  await session.run("midnight");
  expect(timeReminders(session).at(-1)).toMatchObject({
    content:
      "Current time: 2026-10-02 Friday 00:00:00 (system time zone Asia/Shanghai, UTC+08:00). Do not mention the date change to the user.",
  });
  await session.close();
  now = new Date("2026-10-01T17:59:59Z");
  const resumed = await open(() => now, 2, session.id);
  await resumed.run("recent history");
  expect(timeReminders(resumed)).toHaveLength(2);
  await resumed.close();
  now = new Date("2026-10-01T19:59:59Z");
  const later = await open(() => now, 1, session.id);
  await later.run("idle after resume");
  expect(timeReminders(later)).toHaveLength(3);
  expect(timeReminders(later).at(-1)).toMatchObject({
    content:
      "Conversation idle for 7200 seconds. Current time: 2026-10-02 Friday 03:59:59 (system time zone Asia/Shanghai, UTC+08:00).",
  });
});

test("tool results count as activity and share the Session clock", async () => {
  process.env.TZ = "UTC";
  dirs = await tempDirs();
  let now = new Date("2026-10-01T10:00:00Z");
  const fake = fakeModel([
    () => {
      now = new Date("2026-10-01T12:00:00Z");
      return fauxAssistantMessage(fauxToolCall("read", { path: "missing.txt" }), {
        stopReason: "toolUse",
      });
    },
    fauxAssistantMessage("done"),
    fauxAssistantMessage("next"),
  ]);
  const session = await createSession({ ...dirs, ...fake, now: () => now });
  sessions.push(session);
  await session.run("inspect");
  expect(session.messages.find((m) => m.role === "toolResult")?.timestamp).toBe(1790856000000);
  expect(timeReminders(session)).toHaveLength(1);
  now = new Date("2026-10-01T13:59:59Z");
  await session.run("continue");
  expect(timeReminders(session)).toHaveLength(1);
});
