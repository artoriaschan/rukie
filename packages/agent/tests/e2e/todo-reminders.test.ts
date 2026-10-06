import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type SessionEvent } from "../../src/index.ts";
import type { TodoItem } from "../../src/tools/todo/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("the next Run sees the current Todo List and unchanged content is not repeated", async () => {
  dirs = await tempDirs();
  const todos = [
    { content: "Inspect", status: "completed" },
    { content: "Implement", status: "in_progress" },
    { content: "Review", status: "pending" },
  ];
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("todo_write", { todos }), { stopReason: "toolUse" }),
    fauxAssistantMessage("saved"),
    fauxAssistantMessage("continued"),
    fauxAssistantMessage("unchanged"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("plan");
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("continue", { onEvent });
  expect(
    events.filter((event) => event.type === "reminder_injected" && event.source === "todo"),
  ).toEqual([
    {
      type: "reminder_injected",
      sessionId: session.id,
      source: "todo",
      content:
        "Current todo list:\n✓ Inspect\n● Implement\n○ Review\nUpdate the todo list as needed.",
    },
  ]);
  expect(fake.contexts[2]!.messages.slice(-2)).toMatchObject([
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "<system-reminder>\nCurrent todo list:\n✓ Inspect\n● Implement\n○ Review\nUpdate the todo list as needed.\n</system-reminder>",
        },
      ],
    },
    { role: "user", content: [{ type: "text", text: "continue" }] },
  ]);
  events.length = 0;
  await session.run("again", { onEvent });
  expect(
    events.filter((event) => event.type === "reminder_injected" && event.source === "todo"),
  ).toEqual([]);
});

test.each([
  ["empty", []],
  ["completed", [{ content: "Finished", status: "completed" }]],
] satisfies [string, TodoItem[]][])(
  "a %s Todo List does not inject a reminder",
  async (_, todos) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("todo_write", { todos }), { stopReason: "toolUse" }),
      fauxAssistantMessage("saved"),
      fauxAssistantMessage("continued"),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    await session.run("save");
    const events: SessionEvent[] = [];
    await session.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(
      events.some((event) => event.type === "reminder_injected" && event.source === "todo"),
    ).toBe(false);
    expect(JSON.stringify(fake.contexts[2])).not.toContain("Current todo list:");
  },
);

test("Compaction places the current Todo List before the retained conversation tail", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("todo_write", { todos: [{ content: "Initial", status: "pending" }] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("saved"),
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage(
      fauxToolCall("todo_write", { todos: [{ content: "Review", status: "pending" }] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("buffer work ".repeat(260)),
    fauxAssistantMessage(
      fauxToolCall("todo_write", { todos: [{ content: "Review", status: "in_progress" }] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Summary."),
    fauxAssistantMessage("Split summary."),
    fauxAssistantMessage("continued"),
  ]);
  fake.model.contextWindow = 128_000;
  const session = await createSession({ ...dirs, ...fake });
  await session.run("plan");
  await session.run("old");
  await session.run("buffer");
  await session.run("update", {
    onEvent: (event) => {
      if (event.type === "tool_state_changed" && event.name === "todo")
        fake.model.contextWindow = 4000;
    },
  });
  expect(fake.contexts.at(-1)!.messages.slice(1, 8)).toMatchObject([
    { role: "user", content: [{ type: "text", text: expect.stringContaining("Summary.") }] },
    {
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("Current date:") }],
    },
    {
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("Available skills:") }],
    },
    { role: "user", content: [{ type: "text", text: expect.stringContaining("● Review") }] },
    { role: "assistant", content: [{ type: "text", text: "buffer work ".repeat(260) }] },
    { role: "user", content: [{ type: "text", text: expect.stringContaining("○ Review") }] },
    { role: "user", content: [{ type: "text", text: "update" }] },
  ]);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
});

test("changed Todo List content is injected on the next Run", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("todo_write", { todos: [{ content: "Review", status: "pending" }] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("saved"),
    fauxAssistantMessage(
      fauxToolCall("todo_write", { todos: [{ content: "Review", status: "in_progress" }] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("updated"),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("plan");
  await session.run("update");
  const events: SessionEvent[] = [];
  await session.run("continue", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(
    events.filter((event) => event.type === "reminder_injected" && event.source === "todo"),
  ).toMatchObject([{ content: "Current todo list:\n● Review\nUpdate the todo list as needed." }]);
  expect(JSON.stringify(fake.contexts[4])).toContain("● Review");
});

test("the first resumed Run sees the restored unfinished Todo List", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("todo_write", { todos: [{ content: "Resume this", status: "pending" }] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("saved"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("plan");
  const next = fakeModel([fauxAssistantMessage("continued")]);
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  await resumed.run("continue");
  expect(next.contexts[0]!.messages.slice(-2)).toMatchObject([
    { role: "user", content: [{ type: "text", text: expect.stringContaining("○ Resume this") }] },
    { role: "user", content: [{ type: "text", text: "continue" }] },
  ]);
});

test("Compaction immediately persists the current Todo List after the summary for the same Run", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("todo_write", { todos: [{ content: "Review", status: "pending" }] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("saved"),
    fauxAssistantMessage(
      [
        { type: "text", text: "old work ".repeat(2500) },
        fauxToolCall("todo_write", { todos: [{ content: "Review", status: "in_progress" }] }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Summary of old work."),
    fauxAssistantMessage("continued"),
    fauxAssistantMessage("unchanged"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  await session.run("plan");
  const events: SessionEvent[] = [];
  await session.run("work", {
    onEvent: (event) => {
      events.push(event);
      if (event.type === "compaction_end")
        expect(
          structuredClone(
            session.messages.find(
              (message) => message.role === "system-reminder" && message.source === "todo",
            ),
          ),
        ).toMatchObject({
          role: "system-reminder",
          source: "todo",
          content: expect.stringContaining("● Review"),
        });
    },
  });
  expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
  expect(fake.contexts[4]!.messages.slice(1, 5)).toMatchObject([
    {
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("Summary of old work.") }],
    },
    {
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("Current date:") }],
    },
    {
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("Available skills:") }],
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "<system-reminder>\nCurrent todo list:\n● Review\nUpdate the todo list as needed.\n</system-reminder>",
        },
      ],
    },
  ]);
  const next = fakeModel([fauxAssistantMessage("resumed")]);
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
  const unchanged: SessionEvent[] = [];
  await session.run("again", {
    onEvent: (event) => {
      unchanged.push(event);
    },
  });
  expect(
    unchanged.some((event) => event.type === "reminder_injected" && event.source === "todo"),
  ).toBe(false);
});

test("unchanged Todo List and skills reminders are re-injected after each Compaction", async () => {
  dirs = await tempDirs();
  const todos = [{ content: "Review", status: "pending" }];
  const work = () =>
    fauxAssistantMessage(
      [{ type: "text", text: "old work ".repeat(2500) }, fauxToolCall("todo_write", { todos })],
      { stopReason: "toolUse" },
    );
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("todo_write", { todos }), { stopReason: "toolUse" }),
    fauxAssistantMessage("saved"),
    work(),
    fauxAssistantMessage("First summary."),
    work(),
    fauxAssistantMessage("Second summary."),
    fauxAssistantMessage("continued"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  await session.run("plan");
  const events: SessionEvent[] = [];
  await session.run("work", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(2);
  expect(
    events.filter((event) => event.type === "reminder_injected").map((event) => event.source),
  ).toEqual(["todo", "date", "skills", "todo", "date", "skills", "todo"]);
  for (const context of [fake.contexts[4]!, fake.contexts[6]!])
    expect(context.messages[4]).toMatchObject({
      role: "user",
      content: [
        {
          type: "text",
          text: "<system-reminder>\nCurrent todo list:\n○ Review\nUpdate the todo list as needed.\n</system-reminder>",
        },
      ],
    });
  const next = fakeModel([fauxAssistantMessage("resumed")]);
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  const resumedEvents: SessionEvent[] = [];
  await resumed.run("continue", {
    onEvent: (event) => {
      resumedEvents.push(event);
    },
  });
  expect(next.contexts[0]!.messages[4]).toEqual(fake.contexts[6]!.messages[4]);
  expect(
    resumedEvents.some((event) => event.type === "reminder_injected" && event.source === "todo"),
  ).toBe(false);
});

test.each([
  ["cleared", []],
  ["completed", [{ content: "Review", status: "completed" }]],
] satisfies [string, TodoItem[]][])(
  "Compaction does not re-inject a %s Todo List",
  async (_, todos) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("todo_write", { todos: [{ content: "Review", status: "pending" }] }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("saved"),
      fauxAssistantMessage(
        [{ type: "text", text: "old work ".repeat(2500) }, fauxToolCall("todo_write", { todos })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Summary of old work."),
      fauxAssistantMessage("continued"),
    ]);
    fake.model.contextWindow = 4000;
    const session = await createSession({ ...dirs, ...fake });
    await session.run("plan");
    const events: SessionEvent[] = [];
    await session.run("finish", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "reminder_injected" && event.source === "todo"),
    ).toHaveLength(1);
    expect(JSON.stringify(fake.contexts[4])).not.toContain("Current todo list:");
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.toolState("todo")).toEqual(todos);
    expect(
      resumed.messages.some(
        (message) => message.role === "system-reminder" && message.source === "todo",
      ),
    ).toBe(false);
  },
);
