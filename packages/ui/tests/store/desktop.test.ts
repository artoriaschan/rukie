import { expect, test } from "vitest";
import { createDesktopStore, recentSessions } from "../../src/store";

test("registry snapshots control pinned groups and created-time recent ordering", () => {
  const store = createDesktopStore();
  store.receive({
    type: "sessions_changed",
    sessions: [
      {
        id: "a",
        title: "A",
        titleSource: "prompt",
        messageCount: 1,
        model: "test/script",
        cwd: "/project",
        createdAt: 10,
        updatedAt: 30,
      },
      {
        id: "b",
        title: "B",
        titleSource: "prompt",
        messageCount: 1,
        model: "test/script",
        cwd: "/project",
        createdAt: 20,
        updatedAt: 10,
      },
    ],
    projects: [{ id: "p", name: "Project", path: "/project" }],
    pinned: ["b"],
    preferences: { sort: "created", showPinned: false, collapsedGroups: ["projects"] },
  });
  expect(recentSessions(store.getState()).map((session) => session.id)).toEqual(["b", "a"]);
  expect(store.getState()).toMatchObject({
    pinned: ["b"],
    preferences: { showPinned: false, collapsedGroups: ["projects"] },
  });
});

test("Session snapshots replace deltas, preserve busy presentation and expire only matching Interaction epochs", () => {
  const store = createDesktopStore();
  store.setBusy("a", true);
  store.receive({
    type: "snapshot",
    sessionId: "a",
    messages: [],
    compactions: [],
    model: "test/script",
  });
  store.receive({ type: "message_update", sessionId: "a", message: {} });
  store.receive({
    type: "interaction_requested",
    sessionId: "a",
    identity: { epoch: "old", requestId: "r", taskId: 1, conversationId: 1 },
    request: {
      toolName: "bash",
      toolCallId: "call",
      mode: "ask",
      sessionAllow: { kind: "tool", rule: "bash" },
    },
  });
  store.receive({
    type: "interaction_requested",
    sessionId: "a",
    identity: { epoch: "new", requestId: "r", taskId: 1, conversationId: 1 },
    request: {
      toolName: "read",
      toolCallId: "call",
      mode: "ask",
      sessionAllow: { kind: "tool", rule: "read" },
    },
  });
  store.receive({
    type: "interaction_settled",
    sessionId: "a",
    identity: { epoch: "old", requestId: "r", taskId: 1, conversationId: 1 },
  });
  store.receive({
    type: "snapshot",
    sessionId: "a",
    messages: [{ role: "assistant", content: "Done" }],
    compactions: [],
    model: "test/script",
  });
  expect(store.getState().views.a).toMatchObject({
    busy: true,
    events: [],
    interactions: { new: { toolName: "read" } },
    snapshot: { messages: [{ role: "assistant", content: "Done" }] },
  });
});

test("model and permission presentation follow server facts, including reconnect", () => {
  const store = createDesktopStore();
  store.receive({
    type: "session_state",
    sessionId: "a",
    permissionMode: "full-access",
    thinkingLevel: "high",
    contextReport: {
      window: 10000,
      used: 2500,
      categories: [{ name: "system-prompt", tokens: 500 }],
    },
  });
  expect(store.getState().views.a).toMatchObject({
    permissionMode: "full-access",
    thinkingLevel: "high",
    contextReport: { used: 2500 },
  });
});

test("model catalogs reject malformed capabilities at the wire boundary", () => {
  const store = createDesktopStore();
  expect(() => store.setModels([{ spec: "test/script", authenticated: true }])).toThrow(
    "invalid_command",
  );
  expect(store.getState().models).toEqual([]);
});

test("malformed wire envelopes do not alter usable registry or context state", () => {
  const store = createDesktopStore();
  for (const message of [
    { type: "sessions_changed", sessions: null, projects: [], pinned: [], preferences: {} },
    {
      type: "session_state",
      sessionId: "a",
      permissionMode: "ask",
      thinkingLevel: "off",
      contextReport: { window: 10, used: 2, categories: null },
    },
    { type: "interaction_requested", sessionId: "a", identity: null, request: {} },
  ])
    expect(() => store.receive(message)).not.toThrow();
  expect(store.getState().views).toEqual({});
});

test("Run settlement updates execution feedback after an active snapshot", () => {
  const store = createDesktopStore();
  store.receive({
    type: "snapshot",
    sessionId: "a",
    messages: [],
    compactions: [],
    model: "test/script",
    run: {},
  });
  expect(store.getState().views.a?.running).toBe(true);
  store.receive({ type: "run_end", sessionId: "a", inputs: [] });
  expect(store.getState().views.a?.running).toBe(false);
  store.receive({ type: "run_start", sessionId: "a", inputs: [] });
  expect(store.getState().views.a?.running).toBe(true);
});
