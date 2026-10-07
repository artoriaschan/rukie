import { runRequest } from "../helpers/crashed-subagents.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createSession, type SubagentIdentity } from "../../src/index.ts";
import { parseSubagentIdentities } from "../../src/tools/subagents/state.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());
const call = (name: string, args = {}) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

test("a completed child Run keeps its own durable facts and settled parent history after resume", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("subagent", { description: "Reader", prompt: "read", run_in_background: false }),
    fauxAssistantMessage("child answer"),
    fauxAssistantMessage("parent answer"),
  ]);
  const parent = await createSession({ ...dirs, ...fake });
  await runRequest(parent, "delegate");
  const summary = parent.toolState("subagents") as {
    id: string;
    latestRun?: { id: string; outcome: string };
  }[];
  expect(summary[0]?.latestRun).toMatchObject({ outcome: "completed" });
  const child = await parent.readSubagent(summary[0]!.id);
  expect(child?.run).toMatchObject({
    id: summary[0]!.latestRun!.id,
    sessionId: summary[0]!.id,
    parentSessionId: parent.id,
    outcome: "completed",
  });
  expect(child?.messages.at(-1)).toMatchObject({
    role: "assistant",
    content: [{ type: "text", text: "child answer" }],
  });
  await parent.close();
  const untouched = fakeModel([]);
  const restored = await createSession({ ...dirs, ...untouched, resumeId: parent.id });
  expect(restored.toolState("subagents")).toEqual(summary);
  expect(restored.running).toBe(false);
  expect(untouched.contexts).toHaveLength(0);
  await restored.close();
});

test.each(["error", "aborted", "length"] as const)(
  "resume preserves a child model's %s ending without declaring normal completion",
  async (stopReason) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      call("subagent", { description: "Stopped", prompt: "child", run_in_background: false }),
      fauxAssistantMessage("partial", {
        stopReason,
        ...(stopReason === "error" && { errorMessage: "provider failure" }),
      }),
      fauxAssistantMessage("parent done"),
    ]);
    const parent = await createSession({ ...dirs, ...fake });
    await runRequest(parent, "delegate");
    await parent.close();
    const cold = fakeModel([]);
    const resumed = await createSession({ ...dirs, ...cold, resumeId: parent.id });
    expect(resumed.toolState("subagents")).toMatchObject([
      {
        latestRun: {
          outcome: stopReason,
          ...(stopReason === "error" && { error: "provider failure" }),
        },
      },
    ]);
    expect(cold.contexts).toHaveLength(0);
    await resumed.close();
  },
);

test("send_message starts a new child Run, preserves old facts, and Rewind restores the prior parent outcome", async () => {
  dirs = await tempDirs();
  const first = fakeModel([
    call("subagent", { description: "Reader", prompt: "first child", run_in_background: false }),
    fauxAssistantMessage("first answer"),
    fauxAssistantMessage("parent answer"),
  ]);
  const parent = await createSession({ ...dirs, ...first });
  await runRequest(parent, "delegate");
  const original = (parent.toolState("subagents") as SubagentIdentity[])[0]!;
  await parent.close();
  let resumed: Awaited<ReturnType<typeof createSession>>;
  const reply: Parameters<typeof fakeModel>[0][number] = (context) => {
    const isChild = !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
      (tool) => tool.name === "subagent",
    );
    if (isChild) {
      expect(JSON.stringify(context.messages)).toContain("first answer");
      const started = (resumed.toolState("subagents") as SubagentIdentity[])[0]!;
      expect(started.id).toBe(original.id);
      expect(started.latestRun!.id).not.toBe(original.latestRun!.id);
      expect(started.latestRun!.outcome).toBeUndefined();
      return fauxAssistantMessage("partial second answer", {
        stopReason: "error",
        errorMessage: "second failure",
      });
    }
    return fauxAssistantMessage("parent finished");
  };
  const next = fakeModel([
    call("send_message", { agent_id: original.id, message: "second child" }),
    reply,
    reply,
    reply,
  ]);
  resumed = await createSession({ ...dirs, ...next, resumeId: parent.id });
  await runRequest(resumed, "continue");
  const latest = (resumed.toolState("subagents") as SubagentIdentity[])[0]!;
  expect(latest).toMatchObject({
    id: original.id,
    latestRun: { outcome: "error", error: "second failure" },
  });
  const child = await resumed.readSubagent(original.id);
  expect(
    child?.historyMessages?.some(
      (message) =>
        message.role === "assistant" && JSON.stringify(message.content).includes("first answer"),
    ),
  ).toBe(true);
  expect(child?.run).toMatchObject({ id: latest.latestRun!.id, outcome: "error" });
  await resumed.rewind(resumed.checkpoints()[1]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  expect(resumed.toolState("subagents")).toEqual([original]);
  await resumed.close();
  const untouched = fakeModel([]);
  const rewound = await createSession({ ...dirs, ...untouched, resumeId: parent.id });
  expect(rewound.toolState("subagents")).toEqual([original]);
  expect(untouched.contexts).toHaveLength(0);
  await rewound.close();
});

test.each(["missing-native-identity", "foreign-child", "foreign-parent"] as const)(
  "current native directory rejects %s instead of inventing a historical outcome",
  (fixture) => {
    const identity = {
      id: "child",
      description: "Reader",
      type: "general-purpose",
      conversationId: 3,
      driverTaskId: 2,
      originToolTaskId: 1,
      active: false,
      latestRun: {
        id: "2",
        sessionId: fixture === "foreign-child" ? "foreign" : "child",
        parentSessionId: fixture === "foreign-parent" ? "foreign" : "parent",
        startedAt: 10,
      },
    };
    const row =
      fixture === "missing-native-identity"
        ? { id: "child", description: "Reader", type: "general-purpose" }
        : identity;
    expect(() => parseSubagentIdentities([row], "parent")).toThrow();
  },
);

test("a Hook-stopped child Run preserves its distinct reason without a child model request", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("subagent", { description: "Stopped by Hook", prompt: "child", run_in_background: false }),
    fauxAssistantMessage("parent done"),
  ]);
  const parent = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        SubagentStart: [
          {
            hooks: [
              {
                type: "command",
                command: `echo '{"continue":false,"stopReason":"human review required"}'`,
              },
            ],
          },
        ],
      },
    },
  });
  await runRequest(parent, "delegate");
  expect(fake.contexts).toHaveLength(2);
  await parent.close();
  const untouched = fakeModel([]);
  const resumed = await createSession({ ...dirs, ...untouched, resumeId: parent.id });
  expect(resumed.toolState("subagents")).toMatchObject([
    { latestRun: { outcome: "hook_stopped", reason: "human review required" } },
  ]);
  expect(untouched.contexts).toHaveLength(0);
  await resumed.close();
});
