import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createSession, createJsonlStore, type SubagentIdentity } from "../../src/index.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { branchTip, insertEntry, setValue } from "@earendil-works/pi-agent-core/harness/session";
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
  await parent.run("delegate");
  const summary = parent.toolState("subagents") as {
    id: string;
    latestRun?: { id: string; outcome: string };
  }[];
  expect(summary[0]?.latestRun).toMatchObject({ outcome: "completed" });
  const store = createJsonlStore(dirs);
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT)).find(
    (row) => row.id === summary[0]!.id,
  )!;
  const child = await store.open(metadata, BACKGROUND_CONTEXT);
  try {
    const entries = await (await child.branch("main", BACKGROUND_CONTEXT))!.findEntries(
      { order: "oldestFirst" },
      BACKGROUND_CONTEXT,
    );
    const facts = entries.filter(
      (entry) => entry.type === "custom" && entry.customType === "tool-state/subagent-run",
    );
    expect(facts).toMatchObject([
      {
        data: {
          version: 1,
          value: {
            id: summary[0]!.latestRun!.id,
            sessionId: summary[0]!.id,
            parentSessionId: parent.id,
          },
        },
      },
      { data: { version: 1, value: { id: summary[0]!.latestRun!.id, outcome: "completed" } } },
    ]);
  } finally {
    await child.close(BACKGROUND_CONTEXT);
  }
  await parent.dispose();
  const untouched = fakeModel([]);
  const restored = await createSession({ ...dirs, ...untouched, resumeId: parent.id });
  expect(restored.toolState("subagents")).toEqual(summary);
  expect(restored.running).toBe(false);
  expect(untouched.contexts).toHaveLength(0);
  await restored.dispose();
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
    await parent.run("delegate");
    await parent.dispose();
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
    await resumed.dispose();
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
  await parent.run("delegate");
  const original = (parent.toolState("subagents") as SubagentIdentity[])[0]!;
  await parent.dispose();
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
  await resumed.run("continue");
  const latest = (resumed.toolState("subagents") as SubagentIdentity[])[0]!;
  expect(latest).toMatchObject({
    id: original.id,
    latestRun: { outcome: "error", error: "second failure" },
  });
  const store = createJsonlStore(dirs);
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT)).find(
    (row) => row.id === original.id,
  )!;
  const child = await store.open(metadata, BACKGROUND_CONTEXT);
  try {
    const entries = await (await child.branch("main", BACKGROUND_CONTEXT))!.findEntries(
      { order: "oldestFirst" },
      BACKGROUND_CONTEXT,
    );
    expect(
      entries.filter(
        (entry) => entry.type === "custom" && entry.customType === "tool-state/subagent-run",
      ),
    ).toMatchObject([
      { data: { value: { id: original.latestRun!.id } } },
      { data: { value: { id: original.latestRun!.id, outcome: "completed" } } },
      { data: { value: { id: latest.latestRun!.id } } },
      { data: { value: { id: latest.latestRun!.id, outcome: "error" } } },
    ]);
  } finally {
    await child.close(BACKGROUND_CONTEXT);
  }
  await resumed.rewind(resumed.checkpoints()[1]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  expect(resumed.toolState("subagents")).toEqual([original]);
  await resumed.dispose();
  const untouched = fakeModel([]);
  const rewound = await createSession({ ...dirs, ...untouched, resumeId: parent.id });
  expect(rewound.toolState("subagents")).toEqual([original]);
  expect(untouched.contexts).toHaveLength(0);
  await rewound.dispose();
});

for (const fixture of ["legacy", "unsettled", "foreign"] as const) {
  test(`resume keeps ${fixture} child history unknown and list_agents idle without requesting a child`, async () => {
    dirs = await tempDirs();
    const store = createJsonlStore(dirs);
    const stored = await store.create({ cwd: dirs.cwd }, BACKGROUND_CONTEXT);
    await stored.createBranch("main", null, BACKGROUND_CONTEXT);
    const id = stored.idGenerator.next();
    const identity = { id: "historical-child", description: "Old reader", type: "general-purpose" };
    const run = {
      id: "saved-run",
      sessionId: identity.id,
      parentSessionId: fixture === "foreign" ? "another-parent" : stored.metadata.id,
      startedAt: 10,
      ...(fixture === "foreign" && { outcome: "completed", endedAt: 20 }),
    };
    await stored.mutate(
      (mutator) =>
        mutator.commit(
          [
            insertEntry({
              id,
              parentId: null,
              type: "custom",
              customType: "tool-state/subagents",
              data: {
                version: fixture === "legacy" ? 1 : 2,
                value: [{ ...identity, ...(fixture !== "legacy" && { latestRun: run }) }],
              },
            }),
            setValue(branchTip("main"), id),
          ],
          BACKGROUND_CONTEXT,
        ),
      BACKGROUND_CONTEXT,
    );
    await stored.close(BACKGROUND_CONTEXT);
    const fake = fakeModel([
      call("list_agents"),
      (context) => {
        expect(JSON.stringify(context.messages.at(-1))).toContain(
          "historical-child [idle] — Old reader",
        );
        return fauxAssistantMessage("parent continues");
      },
    ]);
    const parent = await createSession({ ...dirs, ...fake, resumeId: stored.metadata.id });
    const identities = parent.toolState("subagents") as SubagentIdentity[];
    expect(identities[0]).toMatchObject(identity);
    expect(identities[0]!.latestRun?.outcome).toBeUndefined();
    expect(parent.running).toBe(false);
    expect(fake.contexts).toHaveLength(0);
    await parent.run("list old child");
    expect(fake.contexts).toHaveLength(2);
    await parent.dispose();
  });
}

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
  await parent.run("delegate");
  expect(fake.contexts).toHaveLength(2);
  await parent.dispose();
  const untouched = fakeModel([]);
  const resumed = await createSession({ ...dirs, ...untouched, resumeId: parent.id });
  expect(resumed.toolState("subagents")).toMatchObject([
    { latestRun: { outcome: "hook_stopped", reason: "human review required" } },
  ]);
  expect(untouched.contexts).toHaveLength(0);
  await resumed.dispose();
});
