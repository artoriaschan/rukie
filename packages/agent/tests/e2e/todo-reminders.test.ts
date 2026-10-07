import { join } from "node:path";
import { withModelAlias } from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type SessionEvent, type Session } from "../../src/index.ts";
import type { TodoItem } from "../../src/tools/todo/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
async function openSession(options: Parameters<typeof createSession>[0]) {
  const session = await createSession(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});
/** Newly committed reminder entries, rather than a second notification protocol. */
function publishedReminders(events: readonly SessionEvent[]) {
  return events.flatMap((event) =>
    event.type === "message_end"
      ? event.messages.flatMap((message) =>
          message.role === "system-reminder"
            ? [{ source: message.source, content: message.content }]
            : [],
        )
      : [],
  );
}

/** Public model selection changes the locked native policy's real context window. */
function windowModels(fake: ReturnType<typeof fakeModel>) {
  const models = withModelAlias(fake.models, "todo-window", ["large"], { contextWindow: 128000 });
  const provider = models.getProviders().find((provider) => provider.id === "todo-window");
  const large = provider?.getModels()[0];
  if (!provider || !large) throw new Error("Missing fixture provider model.");
  models.setProvider({
    ...provider,
    getModels: () => [large, { ...large, id: "small", contextWindow: 16000 }],
  });
  return { models, settings: { model: "todo-window/large" } };
}
const oldEvidence = () =>
  fauxAssistantMessage(
    [fauxToolCall("read", { path: "large.txt" }), fauxToolCall("read", { path: "large.txt" })],
    { stopReason: "toolUse" },
  );
async function evidenceFile() {
  await Bun.write(join(dirs.cwd, "large.txt"), "older evidence ".repeat(6000));
}

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
  const session = await openSession({ ...dirs, ...fake });
  const written: SessionEvent[] = [];
  await session.run("plan", {
    onEvent: (event) => {
      written.push(event);
    },
  });
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("continue", { onEvent });
  expect(publishedReminders(written).filter((event) => event.source === "todo")).toEqual([
    {
      source: "todo",
      content:
        "Current todo list:\n✓ Inspect\n● Implement\n○ Review\nUpdate the todo list as needed.",
    },
  ]);
  expect(fake.contexts[2]!.messages).toContainEqual(
    expect.objectContaining({
      role: "user",
      content: [
        {
          type: "text",
          text: "<system-reminder>\nCurrent todo list:\n✓ Inspect\n● Implement\n○ Review\nUpdate the todo list as needed.\n</system-reminder>",
        },
      ],
    }),
  );
  expect(fake.contexts[2]!.messages.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "continue" }],
  });
  expect(publishedReminders(events).filter((event) => event.source === "todo")).toEqual([]);
  events.length = 0;
  await session.run("again", { onEvent });
  expect(publishedReminders(events).filter((event) => event.source === "todo")).toEqual([]);
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
    const session = await openSession({ ...dirs, ...fake });
    await session.run("save");
    const events: SessionEvent[] = [];
    await session.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(publishedReminders(events).some((event) => event.source === "todo")).toBe(false);
    expect(JSON.stringify(fake.contexts[2])).not.toContain("Current todo list:");
  },
);

test("Compaction places the current Todo List before the retained conversation tail", async () => {
  dirs = await tempDirs();
  await evidenceFile();
  const fake = fakeModel([
    oldEvidence(),
    fauxAssistantMessage("saved older evidence"),
    fauxAssistantMessage(
      fauxToolCall("todo_write", { todos: [{ content: "Review", status: "in_progress" }] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("recent protected reply"),
    fauxAssistantMessage("Summary."),
    fauxAssistantMessage("continued"),
  ]);
  const session = await openSession({ ...dirs, ...fake, ...windowModels(fake) });
  await session.run("read older evidence");
  await session.run("recent retained task");
  await session.setModel("todo-window/small");
  const events: SessionEvent[] = [];
  await session.run("continue", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
  const messages = fake.contexts.at(-1)!.messages;
  const todo = messages.findIndex(
    (message) => message.role === "user" && JSON.stringify(message.content).includes("● Review"),
  );
  const recent = messages.findIndex(
    (message) =>
      message.role === "user" && JSON.stringify(message.content).includes("recent retained task"),
  );
  expect(JSON.stringify(messages)).toContain("Summary.");
  expect(todo).toBeGreaterThanOrEqual(0);
  expect(recent).toBeGreaterThan(todo);
  const persisted = structuredClone(session.messages);
  await session.close();
  const resumed = await openSession({
    ...dirs,
    ...fakeModel([]),
    ...windowModels(fake),
    resumeId: session.id,
  });
  expect(resumed.messages).toEqual(persisted);
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
  const session = await openSession({ ...dirs, ...fake });
  await session.run("plan");
  const changed: SessionEvent[] = [];
  await session.run("update", {
    onEvent: (event) => {
      changed.push(event);
    },
  });
  const events: SessionEvent[] = [];
  await session.run("continue", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(publishedReminders(changed).filter((event) => event.source === "todo")).toMatchObject([
    { content: "Current todo list:\n● Review\nUpdate the todo list as needed." },
  ]);
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
  const session = await openSession({ ...dirs, ...fake });
  await session.run("plan");
  const next = fakeModel([fauxAssistantMessage("continued")]);
  await session.close();
  const resumed = await openSession({ ...dirs, ...next, resumeId: session.id });
  await resumed.run("continue");
  expect(next.contexts[0]!.messages).toContainEqual(
    expect.objectContaining({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("○ Resume this") }],
    }),
  );
  expect(next.contexts[0]!.messages.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "continue" }],
  });
});

test("Compaction immediately persists the current Todo List after the summary for the same Run", async () => {
  dirs = await tempDirs();
  await evidenceFile();
  const fake = fakeModel([
    oldEvidence(),
    fauxAssistantMessage("saved older evidence"),
    fauxAssistantMessage(
      fauxToolCall("todo_write", { todos: [{ content: "Review", status: "in_progress" }] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("recent protected reply"),
    fauxAssistantMessage("Summary of old work."),
    fauxAssistantMessage("continued"),
    fauxAssistantMessage("unchanged"),
    fauxAssistantMessage("resumed"),
  ]);
  const models = windowModels(fake);
  const session = await openSession({ ...dirs, ...fake, ...models });
  await session.run("old evidence");
  await session.run("current task");
  await session.setModel("todo-window/small");
  const events: SessionEvent[] = [];
  await session.run("continue", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).toContain("Summary of old work.");
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).toContain("● Review");
  const summary = session.messages.findIndex(
    (message) => message.role === "session-notice" && message.notice.kind === "compaction",
  );
  expect(session.messages[summary + 1]).toMatchObject({ role: "system-reminder", source: "date" });
  expect(session.messages[summary + 2]).toMatchObject({
    role: "system-reminder",
    source: "skills",
  });
  expect(session.messages[summary + 3]).toMatchObject({
    role: "system-reminder",
    source: "todo",
    content: expect.stringContaining("● Review"),
  });
  const unchanged: SessionEvent[] = [];
  await session.run("again", {
    onEvent: (event) => {
      unchanged.push(event);
    },
  });
  expect(publishedReminders(unchanged).some((message) => message.source === "todo")).toBe(false);
  const persisted = structuredClone(session.messages);
  await session.close();
  const resumed = await openSession({ ...dirs, ...fake, ...models, resumeId: session.id });
  expect(resumed.messages).toEqual(persisted);
  await resumed.run("resume");
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).toContain("● Review");
});

test("unchanged Todo List and skills reminders are re-injected after each Compaction", async () => {
  dirs = await tempDirs();
  await evidenceFile();
  const todos = [{ content: "Review", status: "pending" }];
  const fake = fakeModel([
    oldEvidence(),
    fauxAssistantMessage("first older evidence"),
    fauxAssistantMessage(fauxToolCall("todo_write", { todos }), { stopReason: "toolUse" }),
    fauxAssistantMessage("recent retained task"),
    fauxAssistantMessage("First summary."),
    fauxAssistantMessage("first continued"),
    oldEvidence(),
    fauxAssistantMessage("second older evidence"),
    fauxAssistantMessage("second retained task"),
    fauxAssistantMessage("Second summary."),
    fauxAssistantMessage("second continued"),
    fauxAssistantMessage("resumed"),
  ]);
  const models = windowModels(fake);
  const session = await openSession({ ...dirs, ...fake, ...models });
  await session.run("first older evidence");
  await session.run("current task");
  await session.setModel("todo-window/small");
  const first: SessionEvent[] = [];
  await session.run("first continuation", {
    onEvent: (event) => {
      first.push(event);
    },
  });
  const firstContext = structuredClone(fake.contexts.at(-1)!.messages);
  await session.setModel("todo-window/large");
  await session.run("second older evidence");
  await session.run("second protected task");
  await session.setModel("todo-window/small");
  const second: SessionEvent[] = [];
  await session.run("second continuation", {
    onEvent: (event) => {
      second.push(event);
    },
  });
  expect([...first, ...second].filter((event) => event.type === "compaction_end")).toHaveLength(2);
  for (const events of [first, second])
    expect(publishedReminders(events).map((message) => message.source)).toEqual([
      "date",
      "skills",
      "todo",
    ]);
  for (const messages of [firstContext, fake.contexts.at(-1)!.messages]) {
    expect(JSON.stringify(messages)).toContain("○ Review");
    expect(JSON.stringify(messages)).toContain("Available skills:");
  }
  const current = structuredClone(session.messages);
  await session.close();
  const resumed = await openSession({ ...dirs, ...fake, ...models, resumeId: session.id });
  expect(resumed.messages).toEqual(current);
  const resumedEvents: SessionEvent[] = [];
  await resumed.run("resume", {
    onEvent: (event) => {
      resumedEvents.push(event);
    },
  });
  expect(publishedReminders(resumedEvents).some((message) => message.source === "todo")).toBe(
    false,
  );
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).toContain("○ Review");
});

test.each([
  ["cleared", []],
  ["completed", [{ content: "Review", status: "completed" }]],
] satisfies [string, TodoItem[]][])(
  "Compaction does not re-inject a %s Todo List",
  async (_, todos) => {
    dirs = await tempDirs();
    await evidenceFile();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("todo_write", { todos: [{ content: "Review", status: "pending" }] }),
        { stopReason: "toolUse" },
      ),
      oldEvidence(),
      fauxAssistantMessage("saved older evidence"),
      fauxAssistantMessage(fauxToolCall("todo_write", { todos }), { stopReason: "toolUse" }),
      fauxAssistantMessage("recent retained task"),
      fauxAssistantMessage("Summary of old work."),
      fauxAssistantMessage("continued"),
    ]);
    const models = windowModels(fake);
    const session = await openSession({ ...dirs, ...fake, ...models });
    await session.run("old evidence");
    await session.run("finish tasks");
    await session.setModel("todo-window/small");
    const events: SessionEvent[] = [];
    await session.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
    expect(publishedReminders(events).some((message) => message.source === "todo")).toBe(false);
    expect(JSON.stringify(fake.contexts.at(-1)!.messages)).not.toContain("Current todo list:");
    const persisted = structuredClone(session.messages);
    await session.close();
    const resumed = await openSession({
      ...dirs,
      ...fakeModel([]),
      ...models,
      resumeId: session.id,
    });
    expect(resumed.toolState("todo")).toEqual(todos);
    expect(resumed.messages).toEqual(persisted);
    // Historical Todo reminders stay in the Transcript; the actual provider context
    // above excludes cleared/completed reminders after the native compaction cut.
    expect(
      resumed.messages.some(
        (message) => message.role === "system-reminder" && message.source === "todo",
      ),
    ).toBe(true);
  },
);
