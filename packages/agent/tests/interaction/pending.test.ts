import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context, JsonValue } from "@earendil-works/chord";
import type { TaskRecord } from "@earendil-works/pi-durable";
import { createInteractionIdentity, hasPendingInteraction } from "../../src/interaction/index.ts";

// These fixed IDs represent the native tool Task and its owning Conversation.
const taskId = 42 as TaskRecord<JsonValue, JsonValue, JsonValue>["id"];
const conversationId = 1 as TaskRecord<JsonValue, JsonValue, JsonValue>["conversationId"];
const pendingMemo = {
  "rukie.interaction.mcp__calendar__authenticate": {
    version: 1,
    kind: "mcp__calendar__authenticate",
    phase: "pending",
    taskId: 42,
    conversationId: 1,
    requestId: "interaction:42:mcp__calendar__authenticate",
  },
};
function task(
  state: TaskRecord<JsonValue, JsonValue, JsonValue>["state"] = {
    status: "pending",
    checkpoint: { phase: "call" },
  },
  memos: Record<string, JsonValue> = pendingMemo,
): TaskRecord<JsonValue, JsonValue, JsonValue> {
  const base = {
    id: taskId,
    conversationId,
    kind: "pi.tool",
    version: 1,
    input: { toolName: "mcp__calendar__authenticate", args: {} },
    background: false,
    abortRequested: false,
  };
  if (state.status === "terminal" || state.status === "completing") return { ...base, state };
  return { ...base, state, memos };
}

test("pending interactions identify a recoverable native tool call by kind", () => {
  expect(hasPendingInteraction(task(), (kind) => kind === "mcp__calendar__authenticate")).toBe(
    true,
  );
  expect(hasPendingInteraction(task(), (kind) => kind === "permission")).toBe(false);
});

test("native execution and cancellation take precedence over an old pending memo", () => {
  const states: TaskRecord<JsonValue, JsonValue, JsonValue>["state"][] = [
    { status: "running", checkpoint: { phase: "call" } },
    { status: "waiting", checkpoint: { phase: "call" }, on: [], policy: "allSettled" },
    { status: "pending", checkpoint: { phase: "execute" } },
    { status: "running", checkpoint: { phase: "after" } },
    { status: "pending", checkpoint: null },
    { status: "completing", outcome: { status: "completed", result: null } },
    { status: "terminal", outcome: { status: "completed", result: null } },
  ];
  expect(states.map((state) => hasPendingInteraction(task(state), () => true))).toEqual([
    true,
    true,
    false,
    false,
    false,
    false,
    false,
  ]);
  expect(hasPendingInteraction({ ...task(), abortRequested: true }, () => true)).toBe(false);
  expect(hasPendingInteraction({ ...task(), kind: "pi.generation" }, () => true)).toBe(false);
});

test("pending identification rejects mismatched or malformed persisted identities", () => {
  const name = "rukie.interaction.mcp__calendar__authenticate";
  const memo = pendingMemo[name];
  for (const value of [
    null,
    [],
    "pending",
    { ...memo, version: 2 },
    { ...memo, phase: "done" },
    { ...memo, kind: "permission" },
    { ...memo, taskId: 43 },
    { ...memo, conversationId: 2 },
    { ...memo, requestId: "interaction:43:mcp__calendar__authenticate" },
  ])
    expect(hasPendingInteraction(task(undefined, { [name]: value }), () => true)).toBe(false);
  expect(hasPendingInteraction(task(undefined, {}), () => true)).toBe(false);
  expect(hasPendingInteraction(task(undefined, { wrongMemoName: memo }), () => true)).toBe(false);
});

test("an interaction written through its owner remains recognizable across callback invocations", async () => {
  const memos: Record<string, JsonValue> = {};
  function memo<T extends JsonValue>(name: string, context: Context): Promise<T | undefined>;
  function memo<T extends JsonValue>(name: string, candidate: T, context: Context): Promise<T>;
  async function memo<T extends JsonValue>(
    name: string,
    value: T | Context,
    context?: Context,
  ): Promise<T | undefined> {
    if (context) memos[name] ??= value as T;
    // The native memo contract retains the first candidate for this typed key.
    return memos[name] as T | undefined;
  }
  const api = { taskId, conversationId, memo };
  const first = await createInteractionIdentity(api, "permission", BACKGROUND_CONTEXT);
  const reopened = await createInteractionIdentity(api, "permission", BACKGROUND_CONTEXT);
  expect(first.requestId).toBe("interaction:42:permission");
  expect(reopened.requestId).toBe(first.requestId);
  expect(reopened.epoch).not.toBe(first.epoch);
  expect(hasPendingInteraction(task(undefined, memos), (kind) => kind === "permission")).toBe(true);
});
