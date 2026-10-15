import { join } from "node:path";
import { withModelAlias } from "../helpers/auxiliary-model.ts";
import { runRequest } from "../helpers/crashed-subagents.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createSession, type Session } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
const originalTZ = process.env.TZ;
afterEach(async () => {
  try {
    await Promise.all(sessions.splice(0).map((s) => s.close()));
    await dirs?.cleanup();
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
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

test("child Compaction publishes a fresh time snapshot while retaining the recent time reminder", async () => {
  process.env.TZ = "UTC";
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "old.txt"), "older evidence ".repeat(2200));
  let now = new Date("2026-10-01T10:00:00Z");
  let childCalls = 0;
  let childId = "";
  const response: Parameters<typeof fakeModel>[0][number] = (context) => {
    const parent = getCurrentTools(context.messages).some((tool) => tool.name === "subagent");
    if (parent) {
      const last = context.messages.at(-1);
      const input = last?.role === "user" ? JSON.stringify(last.content) : "";
      if (input.includes("first delegation"))
        return fauxAssistantMessage(
          fauxToolCall("subagent", { description: "Clock", prompt: "old evidence" }),
          { stopReason: "toolUse" },
        );
      const result = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "subagent",
      );
      if (
        result?.role === "toolResult" &&
        result.details &&
        typeof result.details === "object" &&
        "agentId" in result.details
      )
        childId = String(result.details.agentId);
      if (input.includes("second delegation") || input.includes("third delegation"))
        return fauxAssistantMessage(
          fauxToolCall("send_message", {
            agent_id: childId,
            message: input.includes("second delegation")
              ? "recent retained task"
              : "continue after compaction",
          }),
          { stopReason: "toolUse" },
        );
      return fauxAssistantMessage("parent done");
    }
    childCalls++;
    if (childCalls === 1)
      return fauxAssistantMessage(fauxToolCall("read", { path: "old.txt" }), {
        stopReason: "toolUse",
      });
    if (childCalls === 2) return fauxAssistantMessage("old recorded");
    // The retained recent Run stays below the native 20k-token tail budget;
    // older read evidence supplies the prefix cut without dropping its refreshed clock.
    if (childCalls === 3) return fauxAssistantMessage("recent reply ".repeat(3500));
    return fauxAssistantMessage("child summary or continuation");
  };
  const fake = fakeModel(Array.from({ length: 30 }, () => response));
  const models = withModelAlias(fake.models, "child-clock", ["small"], { contextWindow: 16000 });
  const session = await createSession({
    ...dirs,
    ...fake,
    models,
    settings: { subagentModel: "child-clock/small" },
    now: () => now,
  });
  sessions.push(session);
  await runRequest(session, "first delegation");
  now = new Date("2026-10-01T12:00:00Z");
  await runRequest(session, "second delegation");
  now = new Date("2026-10-01T12:00:01Z");
  const childCompactions: string[] = [];
  const events: Parameters<Session["run"]>[1] = {
    onEvent: (event) => {
      if (event.type === "subagent_event" && event.event.type === "compaction_end")
        childCompactions.push(event.agentId);
    },
  };
  await runRequest(session, "third delegation", events);
  const lastChild = fake.contexts.findLast(
    (context) =>
      getCurrentTools(context.messages).some((tool) => tool.name === "read") &&
      !getCurrentTools(context.messages).some((tool) => tool.name === "subagent"),
  );
  const text = JSON.stringify(lastChild?.messages);
  expect(childCompactions).toEqual([childId]);
  expect(text).toContain("child summary or continuation");
  expect(text).toContain("recent retained task");
  expect(text).toContain("Conversation idle for 7200 seconds.");
  expect(text.match(/12:00:01.*?snapshot does not update automatically/g)).toHaveLength(1);
  expect(text).toContain(
    "Current time: 2026-10-01 Thursday 12:00:01 (system time zone UTC, UTC+00:00). This snapshot does not update automatically.",
  );
});
