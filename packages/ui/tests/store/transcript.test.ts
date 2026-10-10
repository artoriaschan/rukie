import { expect, test } from "vitest";
import { createDesktopStore } from "../../src/store";

test("committed entries preserve resumed history and replace streaming partials across microtasks", async () => {
  const store = createDesktopStore();
  const send = (facts: object) => store.receive({ sessionId: "a", ...facts });
  const user = { role: "user", entryId: "1", timestamp: 1, content: "Fix it" };
  send({
    type: "snapshot",
    model: "test/script",
    messages: [user],
    compactions: [],
    queuedInputs: [],
    toolStates: {},
    background: [],
    runSummaries: [],
  });
  send({
    type: "message_update",
    message: { role: "assistant", timestamp: 2, content: [{ type: "text", text: "Checking" }] },
  });
  expect(store.getState().views.a?.transcript?.groups[0]?.messages.at(-1)).toMatchObject({
    content: [{ type: "text", text: "Checking" }],
  });
  const assistant = {
    role: "assistant",
    entryId: "2",
    timestamp: 2,
    content: [
      { type: "text", text: "Checking" },
      { type: "toolCall", id: "call", name: "bash", arguments: { command: "ls" } },
    ],
  };
  await new Promise<void>((resolve) =>
    queueMicrotask(() => {
      send({ type: "message_end", entryId: "2", messages: [assistant] });
      resolve();
    }),
  );
  expect(store.getState().views.a?.transcript?.partial).toBeUndefined();
  send({
    type: "tool_execution_start",
    toolCallId: "call",
    toolName: "bash",
    args: { command: "ls" },
  });
  send({
    type: "tool_execution_update",
    toolCallId: "call",
    toolName: "bash",
    output: { set: "partial" },
  });
  expect(store.getState().views.a?.transcript?.tools["2:call"]?.output).toBe("partial");
  const result = {
    role: "toolResult",
    entryId: "3",
    timestamp: 3,
    toolCallId: "call",
    toolName: "bash",
    isError: true,
    content: [{ type: "text", text: "failed" }],
  };
  send({ type: "tool_execution_end", toolCallId: "call", toolName: "bash", result, isError: true });
  send({ type: "message_end", entryId: "3", messages: [result] });
  send({ type: "message_end", entryId: "3", messages: [result] });
  expect(store.getState().views.a?.transcript?.committed).toEqual([user, assistant, result]);
  send({ type: "message_start", message: result });
  expect(store.getState().views.a?.transcript?.partial).toBeUndefined();
  send({ type: "result", success: false, text: "", durationMs: 75, error: "Aborted" });
  expect(store.getState().views.a?.transcript?.groups).toHaveLength(1);
  expect(store.getState().views.a?.transcript?.tools["2:call"]).toMatchObject({
    status: "error",
    output: "failed",
  });
  expect(store.getState().views.a?.transcript?.groups[0]).toMatchObject({
    status: "aborted",
    durationMs: 75,
  });
  send({
    type: "snapshot",
    model: "test/script",
    messages: [user, assistant, result],
    compactions: [],
    queuedInputs: [],
    toolStates: {},
    background: [],
    runSummaries: [{ afterMessage: 3, durationMs: 75, success: false, endedAt: 4 }],
  });
  expect(store.getState().views.a?.transcript?.groups[0]?.messages).toHaveLength(3);
});

test("wire presentation rejects malformed blocks and queues without corrupting committed history", () => {
  const store = createDesktopStore();
  store.receive({
    type: "snapshot",
    sessionId: "a",
    model: "test/script",
    compactions: [],
    messages: [
      { role: "system", timestamp: 0, content: "system" },
      { role: "user", timestamp: 1, entryId: "u", content: "Question" },
    ],
  });
  expect(store.getState().views.a?.transcript?.groups).toHaveLength(1);
  for (const event of [
    {
      type: "message_end",
      entryId: "bad",
      messages: [{ role: "user", entryId: {}, timestamp: 2, content: "Corrupt identity" }],
    },
    {
      type: "message_update",
      message: {
        role: "assistant",
        timestamp: 2,
        content: [{ type: "toolCall", id: "x", arguments: {} }],
      },
    },
    { type: "queued_inputs_update", items: [{ requestId: "bad", prompt: "broken", images: null }] },
    {
      type: "tool_execution_start",
      toolCallId: "bad",
      toolName: "bash",
      view: { card: "diff", diffs: null },
    },
  ])
    store.receive({ sessionId: "a", ...event });
  expect(store.getState().views.a?.transcript?.queued).toEqual([]);
  expect(store.getState().views.a?.transcript?.groups[0]?.messages).toHaveLength(1);
  store.receive({
    type: "snapshot",
    sessionId: "a",
    model: "test/script",
    compactions: [],
    messages: [
      { role: "user", timestamp: 1, entryId: "u", content: "Question" },
      { role: "session-notice", timestamp: 2, notice: { kind: "interrupted" } },
    ],
  });
  expect(store.getState().views.a?.transcript?.groups[0]?.status).toBe("aborted");
});

test("reused provider tool IDs retain each committed call's arguments and output", () => {
  const store = createDesktopStore();
  const messages = Array.from({ length: 2 }, (_, index) => [
    { role: "user", entryId: `user-${index}`, timestamp: index, content: `Prompt ${index}` },
    {
      role: "assistant",
      entryId: `assistant-${index}`,
      timestamp: index,
      content: [
        {
          type: "toolCall",
          id: "reused",
          name: "bash",
          arguments: { command: `command-${index}` },
        },
      ],
    },
    {
      role: "toolResult",
      entryId: `result-${index}`,
      timestamp: index,
      toolCallId: "reused",
      toolName: "bash",
      isError: index === 0,
      content: [{ type: "text", text: `output-${index}` }],
    },
  ]).flat();
  store.receive({
    type: "snapshot",
    sessionId: "a",
    model: "test/script",
    compactions: [],
    messages,
  });
  expect(
    Object.values(store.getState().views.a?.transcript?.tools ?? {}).map((tool) => ({
      args: tool.args,
      output: tool.output,
      status: tool.status,
    })),
  ).toEqual([
    { args: { command: "command-0" }, output: "output-0", status: "error" },
    { args: { command: "command-1" }, output: "output-1", status: "success" },
  ]);
  store.receive({
    type: "tool_execution_update",
    sessionId: "a",
    toolCallId: "reused",
    output: { set: "new live output" },
  });
  expect(store.getState().views.a?.transcript?.tools["assistant-0:reused"]?.output).toBe(
    "output-0",
  );
});
