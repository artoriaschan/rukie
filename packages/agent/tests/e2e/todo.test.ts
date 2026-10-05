import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { appendFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each(["ask", "auto-review", "full-access"] as const)(
  "todo_write replaces the list without approval in %s mode",
  async (permissionMode) => {
    dirs = await tempDirs();
    const todos = [
      { content: "  Inspect code  ", status: "completed" },
      { content: "Implement", status: "in_progress" },
      { content: "Review", status: "in_progress" },
      { content: "Ship", status: "pending" },
    ];
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("todo_write", { todos }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      onPermissionAsk: async () => {
        throw new Error("todo_write must bypass permission approval");
      },
    });

    expect(
      (
        await session.run("plan", {
          onEvent: (event) => {
            events.push(structuredClone(event));
          },
        })
      ).text,
    ).toBe("done");
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: false,
      content: [
        { type: "text", text: "Updated todo list: 1 pending, 2 in progress, 1 completed." },
      ],
    });
    const expected = [
      { content: "Inspect code", status: "completed" },
      { content: "Implement", status: "in_progress" },
      { content: "Review", status: "in_progress" },
      { content: "Ship", status: "pending" },
    ];
    expect(session.toolState("todo")).toEqual(expected);
    expect(
      events.filter((event) => event.type === "tool_state_changed" && event.name === "todo"),
    ).toEqual([
      { type: "tool_state_changed", sessionId: session.id, name: "todo", value: expected },
    ]);
    expect(
      events.some(
        (event) => event.type === "permission_review" || event.type === "permission_denied",
      ),
    ).toBe(false);
    expect(events.find((event) => event.type === "session_start")).toMatchObject({
      tools: expect.arrayContaining(["todo_write"]),
    });
  },
);

test.each([
  [[{ content: " \n ", status: "pending" }], "non-empty"],
  [
    [
      { content: "same", status: "pending" },
      { content: " same ", status: "completed" },
    ],
    "duplicate",
  ],
  [[{ content: "extended", status: "pending", extra: true }], "extra"],
  [[{ content: "unknown", status: "cancelled" }], "status"],
  [[{ status: "pending" }], "content"],
] as const)(
  "invalid todos return an error and preserve the previous list (%j)",
  async (invalid, message) => {
    dirs = await tempDirs();
    const todos = [{ content: "Keep this", status: "pending" }];
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("todo_write", { todos }), { stopReason: "toolUse" }),
      fauxAssistantMessage("saved"),
      fauxAssistantMessage(fauxToolCall("todo_write", { todos: invalid }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("recovered"),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    await session.run("save");
    const events: SessionEvent[] = [];
    await session.run("invalid", {
      onEvent: (event) => {
        events.push(structuredClone(event));
      },
    });
    expect(fake.contexts[3]!.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: true,
      content: [{ type: "text", text: expect.stringContaining(message) }],
    });
    expect(session.toolState("todo")).toEqual(todos);
    expect(
      events.some((event) => event.type === "tool_state_changed" && event.name === "todo"),
    ).toBe(false);
  },
);

test("the latest complete snapshot survives resume and an empty list clears it", async () => {
  dirs = await tempDirs();
  const todos = [
    { content: "Read", status: "pending" },
    { content: "Write", status: "in_progress" },
  ];
  const replacement = [{ content: "Ship", status: "completed" }];
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("todo_write", { todos }), { stopReason: "toolUse" }),
    fauxAssistantMessage("first"),
    fauxAssistantMessage(fauxToolCall("todo_write", { todos: replacement }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("second"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  expect(session.toolState("todo")).toBeUndefined();
  expect(session.toolState("missing")).toBeUndefined();
  await session.run("plan");
  await session.run("replace");
  const next = fakeModel([
    fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), { stopReason: "toolUse" }),
    fauxAssistantMessage("cleared"),
  ]);
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  expect(resumed.toolState("todo")).toEqual(replacement);
  expect(resumed.messages).toEqual(session.messages);
  const events: SessionEvent[] = [];
  await resumed.run("clear", {
    onEvent: (event) => {
      events.push(structuredClone(event));
    },
  });
  expect(next.contexts[1]!.messages.at(-1)).toMatchObject({
    isError: false,
    content: [{ type: "text", text: "Updated todo list: 0 pending, 0 in progress, 0 completed." }],
  });
  expect(resumed.toolState("todo")).toEqual([]);
  expect(
    events.filter((event) => event.type === "tool_state_changed" && event.name === "todo"),
  ).toEqual([{ type: "tool_state_changed", sessionId: session.id, name: "todo", value: [] }]);
  const reopened = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(reopened.toolState("todo")).toEqual([]);
});

test.each([
  { version: 2, value: [] },
  { version: "1", value: [] },
  { version: 1, value: "not an array" },
  { version: 1, value: [null] },
  { version: 1, value: [{ content: "bad status", status: "cancelled" }] },
  { version: 1, value: [{ status: "pending" }] },
  { version: 1, value: [{ content: "extra field", status: "pending", extra: true }] },
  null,
])(
  "a corrupt Tool State snapshot is warned about and resume keeps the valid list (%j)",
  async (data) => {
    dirs = await tempDirs();
    const todos = [
      { content: "Parallel one", status: "in_progress" },
      { content: "Parallel two", status: "in_progress" },
    ];
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("todo_write", { todos }), { stopReason: "toolUse" }),
      fauxAssistantMessage("saved"),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    await session.run("plan");
    const root = join(dirs.homeDir, ".neant/sessions");
    const files = (await readdir(root, { recursive: true })).filter((file) =>
      file.endsWith(".jsonl"),
    );
    expect(files).toHaveLength(1);
    const path = join(root, files[0]!);
    const records = (await Bun.file(path).text())
      .trim()
      .split("\n")
      .flatMap((line) => JSON.parse(line));
    const last = records.at(-1);
    // Fault injection in pi's native v4 transaction format, advancing the same main branch.
    const id = "corrupt-todo";
    await appendFile(
      path,
      `${JSON.stringify([
        {
          kind: "entry",
          type: "custom",
          customType: "tool-state/todo",
          id,
          parentId: last.value,
          seq: last.seq + 1,
          timestamp: Date.now(),
          data,
        },
        {
          kind: "value",
          op: "set",
          namespace: "pi.branch.tip",
          key: "main",
          value: id,
          seq: last.seq + 2,
        },
      ])}\n`,
    );
    const warnings: string[] = [];
    const next = fakeModel([fauxAssistantMessage("continued")]);
    const resumed = await createSession({
      ...dirs,
      ...next,
      resumeId: session.id,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });
    expect(resumed.toolState("todo")).toEqual(todos);
    expect(warnings).toEqual([expect.stringContaining("tool-state/todo")]);
    expect(warnings[0]).toContain(id);
    expect((await resumed.run("continue")).text).toBe("continued");
    expect(resumed.toolState("todo")).toEqual(todos);
  },
);
