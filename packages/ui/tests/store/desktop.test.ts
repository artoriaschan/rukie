import { expect, test } from "vitest";
import { createDesktopStore, recentSessions } from "../../src/store";

test("registry presentation accepts authoritative home and rejects malformed home metadata", () => {
  const store = createDesktopStore();
  const message = {
    type: "sessions_changed",
    homeDir: "/custom/canonical-home",
    sessions: [],
    projects: [],
    pinned: [],
    archived: [],
    preferences: {},
  };
  store.receive(message);
  expect(store.getState()).toMatchObject({ homeDir: "/custom/canonical-home" });
  for (const homeDir of [undefined, null, 42, ""]) {
    store.receive({ ...message, homeDir, preferences: { showPinned: false } });
    expect(store.getState()).toMatchObject({ homeDir: "/custom/canonical-home", preferences: {} });
  }
});

test("registry snapshots preserve pin membership and selected Session sort ordering", () => {
  const store = createDesktopStore();
  store.receive({
    type: "sessions_changed",
    homeDir: "/fixture-home",
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
    projects: [
      { id: "p", name: "Project", directories: ["/project"], primary: "/project", trusted: true },
    ],
    pinned: ["b"],
    archived: [],
    preferences: { sort: "created", showPinned: false, collapsedGroups: ["projects"] },
  });
  expect(recentSessions(store.getState()).map((session) => session.id)).toEqual(["b", "a"]);
  expect(store.getState()).toMatchObject({
    pinned: ["b"],
    archived: [],
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

test("cold history reads validated thinking and permission presentation without a live Session", () => {
  const store = createDesktopStore();
  const snapshot = {
    type: "snapshot",
    sessionId: "cold",
    messages: [],
    compactions: [],
    model: "test/script",
    agent: { thinkingLevel: "high" },
    permissionMode: "full-access",
  };
  store.receive(snapshot);
  expect(store.getState().views.cold).toMatchObject({
    thinkingLevel: "high",
    permissionMode: "full-access",
  });
  store.receive({ ...snapshot, agent: { thinkingLevel: "invalid" }, permissionMode: "invalid" });
  expect(store.getState().views.cold).toMatchObject({
    thinkingLevel: "high",
    permissionMode: "full-access",
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
    {
      type: "sessions_changed",
      homeDir: "/fixture-home",
      sessions: null,
      projects: [],
      pinned: [],
      preferences: {},
    },
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

test("permission placement captures the current partial call without rebinding reused IDs", () => {
  const store = createDesktopStore();
  const assistant = (entryId: string | undefined, timestamp: number) => ({
    role: "assistant",
    entryId,
    timestamp,
    content: [{ type: "toolCall", id: "same", name: "bash", arguments: { command: "ls" } }],
  });
  store.receive({
    type: "snapshot",
    sessionId: "a",
    compactions: [],
    model: "test/script",
    messages: [
      { role: "user", entryId: "u", timestamp: 1, content: "Review" },
      assistant("old", 10),
    ],
  });
  store.receive({ type: "message_update", sessionId: "a", message: assistant(undefined, 20) });
  const identity = { epoch: "p", requestId: "r", taskId: 1, conversationId: 1 };
  store.receive({
    type: "interaction_requested",
    sessionId: "a",
    identity,
    request: {
      identity,
      toolName: "bash",
      toolCallId: "same",
      args: { command: "ls" },
      mode: "ask",
      sessionAllow: { kind: "tool", rule: "bash" },
    },
  });
  const request = store.getState().views.a!.interactions.p!;
  expect(request.placement).toEqual({
    groupId: "u",
    entryId: undefined,
    timestamp: 20,
    blockIndex: 0,
    before: true,
  });
  store.receive({
    type: "message_end",
    sessionId: "a",
    entryId: "new",
    messages: [assistant("new", 20)],
  });
  store.resolveInteraction("a", "p", { request, reply: "allow" });
  expect(store.getState().views.a!.permissionDecisions!.p!.request.placement?.timestamp).toBe(20);
});

test("subagent permissions retain their parent activity position instead of matching a reused child call ID", () => {
  const store = createDesktopStore();
  store.receive({
    type: "snapshot",
    sessionId: "a",
    compactions: [],
    model: "test/script",
    messages: [
      { role: "user", entryId: "u", timestamp: 1, content: "Review" },
      {
        role: "assistant",
        entryId: "parent",
        timestamp: 10,
        content: [
          { type: "toolCall", id: "same", name: "task", arguments: {} },
          { type: "text", text: "Child work" },
        ],
      },
    ],
  });
  const identity = { epoch: "child", requestId: "r", taskId: 2, conversationId: 2 };
  store.receive({
    type: "interaction_requested",
    sessionId: "a",
    identity,
    request: {
      identity,
      toolName: "bash",
      toolCallId: "same",
      args: { command: "ls" },
      origin: { agentId: "child", description: "Inspect files" },
      mode: "ask",
      sessionAllow: { kind: "tool", rule: "bash" },
    },
  });
  expect(store.getState().views.a!.interactions.child!.placement).toEqual({
    groupId: "u",
    entryId: "parent",
    timestamp: 10,
    blockIndex: 1,
    before: false,
  });
});

test("model catalogs preserve known provider icons and reject unknown icon keys", () => {
  const store = createDesktopStore();
  const model = {
    spec: "deepseek/flash",
    id: "flash",
    name: "Flash",
    providerId: "deepseek",
    providerName: "DeepSeek",
    providerIcon: "deepseek",
    input: ["text"],
    reasoning: false,
    thinkingLevels: ["off"],
    contextWindow: 10000,
    custom: true,
    authenticated: false,
  };
  store.setModels([model]);
  expect(store.getState().models[0]?.providerIcon).toBe("deepseek");
  expect(() => store.setModels([{ ...model, providerIcon: "unknown" }])).toThrow("invalid_command");
  expect(store.getState().models[0]?.providerIcon).toBe("deepseek");
});

test("archive envelopes invalidate cached history and reject invalid archived ids", () => {
  const store = createDesktopStore();
  const registry = {
    type: "sessions_changed",
    homeDir: "/fixture-home",
    sessions: [],
    projects: [],
    pinned: [],
    archived: ["a"],
    preferences: {},
  };
  store.receive({
    type: "snapshot",
    sessionId: "a",
    messages: [],
    compactions: [],
    model: "test/script",
  });
  store.receive({ ...registry, closedSessionId: "a" });
  expect(store.getState()).toMatchObject({ archived: ["a"] });
  expect(store.getState().views.a).toBeUndefined();
  for (const archived of [null, "a", [1], undefined]) {
    store.receive({ ...registry, archived, pinned: ["changed"] });
    expect(store.getState()).toMatchObject({ archived: ["a"], pinned: [] });
  }
});

test("multi-directory Projects parse complete state and reject missing membership or trust", () => {
  const store = createDesktopStore();
  const project = {
    id: "p",
    name: "Cross repo",
    directories: ["/first", "/second"],
    primary: "/second",
    trusted: false,
  };
  const message = {
    type: "sessions_changed",
    homeDir: "/fixture-home",
    projects: [project],
    sessions: [],
    pinned: [],
    archived: [],
    preferences: {},
  };
  store.receive(message);
  expect(store.getState().projects).toEqual([project]);
  for (const invalid of [
    { ...project, directories: [] },
    { ...project, directories: ["/first", "/first"] },
    { ...project, primary: "/outside" },
    { ...project, trusted: "true" },
    { id: "old", name: "Old", path: "/legacy" },
  ])
    store.receive({ ...message, projects: [invalid] });
  expect(store.getState().projects).toEqual([project]);
});

test("Project edit and removal snapshots preserve Session membership facts, pin and archive state", () => {
  const store = createDesktopStore();
  const session = {
    id: "s",
    title: "Kept",
    titleSource: "prompt",
    messageCount: 1,
    model: "test/script",
    cwd: "/first",
    createdAt: 1,
    updatedAt: 2,
  };
  const project = {
    id: "p",
    name: "Edited Project",
    directories: ["/first", "/second"],
    primary: "/second",
    trusted: true,
  };
  const message = {
    type: "sessions_changed",
    homeDir: "/fixture-home",
    projects: [project],
    sessions: [session],
    pinned: ["s"],
    archived: ["archived"],
    preferences: {},
  };
  store.receive(message);
  expect(store.getState()).toMatchObject({
    projects: [project],
    sessions: [session],
    pinned: ["s"],
    archived: ["archived"],
  });
  store.receive({ ...message, projects: [{ ...project, name: 42 }] });
  expect(store.getState().projects).toEqual([project]);
  store.receive({ ...message, projects: [] });
  expect(store.getState()).toMatchObject({
    projects: [],
    sessions: [session],
    pinned: ["s"],
    archived: ["archived"],
  });
});
