import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createSession as createNativeSession,
  ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { todoState } from "../../src/tools/todo/index.ts";
import {
  createSession as createSessionImpl,
  createJsonlStore,
  type Session,
  type SessionEvent,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
async function createSession(options: Parameters<typeof createSessionImpl>[0]) {
  const session = await createSessionImpl(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});

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
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({
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
    expect(getCurrentTools(fake.contexts[0]!.messages).map((tool) => tool.name)).toContain(
      "todo_write",
    );
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
    expect(
      fake.contexts[3]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({
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
  const history = structuredClone([...session.messages]);
  await session.close();
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  expect(resumed.toolState("todo")).toEqual(replacement);
  expect([...resumed.messages]).toEqual(history);
  const events: SessionEvent[] = [];
  await resumed.run("clear", {
    onEvent: (event) => {
      events.push(structuredClone(event));
    },
  });
  expect(
    next.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({
    isError: false,
    content: [{ type: "text", text: "Updated todo list: 0 pending, 0 in progress, 0 completed." }],
  });
  expect(resumed.toolState("todo")).toEqual([]);
  expect(
    events.filter((event) => event.type === "tool_state_changed" && event.name === "todo"),
  ).toEqual([{ type: "tool_state_changed", sessionId: session.id, name: "todo", value: [] }]);
  await resumed.close();
  const reopened = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(reopened.toolState("todo")).toEqual([]);
});

const malformedTodos: { value: JsonValue }[] = [
  { value: "not an array" },
  { value: [null] },
  { value: [{ content: "bad status", status: "cancelled" }] },
  { value: [{ status: "pending" }] },
  { value: [{ content: "extra field", status: "pending", extra: true }] },
  { value: { content: "not a list", status: "pending" } },
];
test.each(malformedTodos)(
  "resume rejects a malformed native Todo document before model execution (%j)",
  async ({ value }) => {
    dirs = await tempDirs();
    const store = createJsonlStore(dirs);
    const session = await createSession({
      ...dirs,
      store,
      ...fakeModel([
        fauxAssistantMessage(
          fauxToolCall("todo_write", { todos: [{ content: "Keep", status: "pending" }] }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("saved"),
      ]),
    });
    await session.run("plan");
    await session.close();
    const lease = await store.open({ id: session.id }, BACKGROUND_CONTEXT);
    const native = createNativeSession(lease.storage);
    try {
      await native.commit(async (tx) => {
        (await tx.doc(todoState.document, ROOT_CONVERSATION_ID)).value = value;
      }, BACKGROUND_CONTEXT);
    } finally {
      await native.close(BACKGROUND_CONTEXT);
      await lease.release();
    }
    const fake = fakeModel([]);
    await expect(createSession({ ...dirs, store, ...fake, resumeId: session.id })).rejects.toThrow(
      "Invalid todo list schema",
    );
    expect(fake.contexts).toHaveLength(0);
  },
);
