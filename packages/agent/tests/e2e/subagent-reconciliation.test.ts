import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createSession, type SubagentIdentity } from "../../src/index.ts";
import { parseSubagentIdentities } from "../../src/tools/subagents/state.ts";
import { crashedSubagents, runRequest } from "../helpers/crashed-subagents.ts";
import { crashUnsafeEffect } from "../helpers/native-recovery.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { join } from "node:path";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

const resumedReply: Parameters<typeof fakeModel>[0][number] = (context) =>
  getCurrentSystemMessage(context.messages)?.toolsAdded?.some((tool) => tool.name === "subagent")
    ? fauxAssistantMessage("parent observed child")
    : fauxAssistantMessage("resumed child answer");

test("native pending child checkpoints resume while saved completed and failed endings remain exact", async () => {
  dirs = await tempDirs();
  const fixture = await crashedSubagents(dirs);
  const pending = await fixture.child("Pending reader");
  const completed = await fixture.child("Already finished", "completed");
  const failed = await fixture.child("Provider failed", "error");
  await fixture.save();
  const fake = fakeModel(Array.from({ length: 10 }, () => resumedReply));
  const parent = await createSession({ ...dirs, ...fake, resumeId: fixture.parentId });
  try {
    await parent.waitForRequest(pending.requestId);
    const rows = parent.toolState("subagents") as SubagentIdentity[];
    expect(rows.find((row) => row.id === pending.metadata.id)).toMatchObject({
      active: false,
      latestRun: { id: pending.run.id, outcome: "completed" },
    });
    expect(rows.find((row) => row.id === completed.metadata.id)?.latestRun).toEqual(completed.run);
    expect(rows.find((row) => row.id === failed.metadata.id)?.latestRun).toEqual(failed.run);
    expect(
      (await parent.readSubagent(pending.metadata.id))?.messages.some(
        (message) =>
          message.role === "assistant" &&
          JSON.stringify(message.content).includes("resumed child answer"),
      ),
    ).toBe(true);
    expect(
      parent.messages.filter(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("(Pending reader) finished."),
      ),
    ).toHaveLength(1);
  } finally {
    await parent.close();
  }
});

test.each(["missing", "header", "body"] as const)(
  "native shared storage %s failure rejects resume without fabricating child state or altering bytes",
  async (damage) => {
    dirs = await tempDirs();
    const fixture = await crashedSubagents(dirs);
    await fixture.child("Saved", "completed");
    await fixture.save();
    const path = join(fixture.store.key(fixture.parentId), "main.jsonl");
    if (damage === "missing") await (await import("node:fs/promises")).unlink(path);
    else if (damage === "header") await Bun.write(path, "invalid header\n");
    else await (await import("node:fs/promises")).appendFile(path, "invalid body\n");
    const baseline = damage === "missing" ? undefined : await Bun.file(path).bytes();
    const fake = fakeModel([]);
    await expect(createSession({ ...dirs, ...fake, resumeId: fixture.parentId })).rejects.toThrow();
    expect(fake.contexts).toHaveLength(0);
    if (baseline) expect(await Bun.file(path).bytes()).toEqual(baseline);
  },
);

test("passive child observations share the parent lease, never scan separate stores, and release the lease on close", async () => {
  dirs = await tempDirs();
  const fixture = await crashedSubagents(dirs);
  const children = [];
  for (let index = 0; index < 3; index++)
    children.push(await fixture.child(`Settled ${index}`, "completed"));
  await fixture.save();
  let opens = 0;
  const store = {
    ...fixture.store,
    list: async () => {
      throw new Error("Directory scans are forbidden.");
    },
    async open(...args: Parameters<typeof fixture.store.open>) {
      opens++;
      return fixture.store.open(...args);
    },
  };
  const fake = fakeModel([]);
  const parent = await createSession({ ...dirs, ...fake, store, resumeId: fixture.parentId });
  try {
    for (const child of children)
      expect((await parent.readSubagent(child.metadata.id))?.run).toEqual(child.run);
    expect(opens).toBe(1);
    expect(fake.contexts).toHaveLength(0);
  } finally {
    await parent.close();
  }
  const released = await fixture.store.open({ id: fixture.parentId }, BACKGROUND_CONTEXT);
  await released.release();
});

test("injected native Store remains a single explicit storage lease with no invented child-open protocol", async () => {
  dirs = await tempDirs();
  const fixture = await crashedSubagents(dirs);
  const child = await fixture.child("Opaque storage", "completed");
  await fixture.save();
  let opened = 0;
  const store = {
    key: fixture.store.key,
    list: fixture.store.list,
    async open(...args: Parameters<typeof fixture.store.open>) {
      opened++;
      return fixture.store.open(...args);
    },
  };
  const parent = await createSession({
    ...dirs,
    ...fakeModel([]),
    store,
    resumeId: fixture.parentId,
  });
  try {
    expect((await parent.readSubagent(child.metadata.id))?.run?.outcome).toBe("completed");
    expect(opened).toBe(1);
  } finally {
    await parent.close();
  }
});

for (const mismatch of ["native-id", "child", "parent", "active", "start", "entry"] as const)
  test(`${mismatch} association mismatch is rejected instead of inventing an interrupted Run`, () => {
    const row = {
      id: "child",
      description: "Reader",
      type: "general-purpose",
      conversationId: 3,
      driverTaskId: 2,
      originToolTaskId: 1,
      active: false,
      latestRun: {
        id: "2",
        sessionId: "child",
        parentSessionId: "parent",
        startedAt: 10,
        promptEntryId: 4,
      },
    };
    const value = {
      ...row,
      ...(mismatch === "native-id" ? { conversationId: "other-child" } : {}),
      ...(mismatch === "active" ? { active: "running" } : {}),
      latestRun: {
        ...row.latestRun,
        ...(mismatch === "child" ? { sessionId: "foreign-child" } : {}),
        ...(mismatch === "parent" ? { parentSessionId: "foreign-parent" } : {}),
        ...(mismatch === "start" ? { startedAt: NaN } : {}),
        ...(mismatch === "entry" ? { promptEntryId: 4.5 } : {}),
      },
    };
    expect(() => parseSubagentIdentities([value], "parent")).toThrow();
  });

test("an idle child continuation owns a new native Run and does not borrow the earlier completion", async () => {
  dirs = await tempDirs();
  const first = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Reader",
        prompt: "first",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("saved exploration"),
    fauxAssistantMessage("parent done"),
  ]);
  const original = await createSession({ ...dirs, ...first });
  await original.run("delegate");
  const prior = (original.toolState("subagents") as SubagentIdentity[])[0]!;
  await original.close();
  const response: Parameters<typeof fakeModel>[0][number] = (context) =>
    getCurrentSystemMessage(context.messages)?.toolsAdded?.some((tool) => tool.name === "subagent")
      ? fauxAssistantMessage("parent done")
      : fauxAssistantMessage("second partial", {
          stopReason: "error",
          errorMessage: "second failure",
        });
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("send_message", { agent_id: prior.id, message: "continue" }),
      { stopReason: "toolUse" },
    ),
    response,
    response,
    response,
  ]);
  const parent = await createSession({ ...dirs, ...fake, resumeId: original.id });
  try {
    await runRequest(parent, "continue child");
    const row = (parent.toolState("subagents") as SubagentIdentity[])[0]!;
    expect(row.id).toBe(prior.id);
    expect(row.conversationId).not.toBe(prior.conversationId);
    expect(row.latestRun?.id).not.toBe(prior.latestRun?.id);
    expect(row.latestRun).toMatchObject({ outcome: "error", error: "second failure" });
    expect(
      (await parent.readSubagent(row.id))?.historyMessages?.some((message) =>
        JSON.stringify(message).includes("saved exploration"),
      ),
    ).toBe(true);
  } finally {
    await parent.close();
  }
});

test("native fork history cannot impersonate its own child Run facts", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("saved parent answer"),
    fauxAssistantMessage(
      fauxToolCall("subagent_fork", {
        description: "Forked",
        prompt: "fork input",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("own fork answer"),
    fauxAssistantMessage("parent done"),
  ]);
  const parent = await createSession({ ...dirs, ...fake });
  try {
    await parent.run("first input");
    await parent.run("fork now");
    const row = (parent.toolState("subagents") as SubagentIdentity[])[0]!;
    const child = await parent.readSubagent(row.id);
    expect(child?.run).toMatchObject({
      id: String(row.driverTaskId),
      sessionId: row.id,
      parentSessionId: parent.id,
      outcome: "completed",
    });
    expect(
      child?.historyMessages?.some((message) =>
        JSON.stringify(message).includes("saved parent answer"),
      ),
    ).toBe(true);
    expect(child?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "own fork answer" }],
    });
  } finally {
    await parent.close();
  }
});

test("an interrupted unsafe child effect is not replayed and explicit continuation keeps its committed history", async () => {
  dirs = await tempDirs();
  const saved = await crashUnsafeEffect(dirs.cwd, true);
  if (!saved.childId) throw new Error("Native crash child identity missing.");
  const childId = saved.childId;
  let sending = false;
  const response: Parameters<typeof fakeModel>[0][number] = (context) => {
    if (
      !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
        (tool) => tool.name === "subagent",
      )
    )
      return fauxAssistantMessage("child continues safely");
    const lastUser = context.messages.findLast((message) => message.role === "user");
    if (!sending && JSON.stringify(lastUser?.content).includes("continue saved child")) {
      sending = true;
      return fauxAssistantMessage(
        fauxToolCall("send_message", { agent_id: childId, message: "continue safely" }),
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage("parent observed outcome");
  };
  const fake = fakeModel(Array.from({ length: 15 }, () => response));
  const parent = await createSession({
    ...dirs,
    homeDir: dirs.cwd,
    ...fake,
    resumeId: saved.sessionId,
    permissionMode: "full-access",
  });
  try {
    await parent.waitForRequest(parent.currentRequestId!);
    const child = await parent.readSubagent(childId);
    expect(
      child?.messages.filter(
        (message) => message.role === "toolResult" && message.toolName === "write",
      ),
    ).toMatchObject([{ isError: true, outcomeUnknown: true }]);
    expect(await Bun.file(join(dirs.cwd, "uncertain-effect.txt")).text()).toBe("saved effect");
    await Bun.write(join(dirs.cwd, "uncertain-effect.txt"), "externally reconciled");
    await runRequest(parent, "continue saved child");
    const continued = await parent.readSubagent(childId);
    expect(
      continued?.historyMessages?.filter(
        (message) => message.role === "toolResult" && message.toolName === "write",
      ),
    ).toMatchObject([{ isError: true, outcomeUnknown: true }]);
    expect(continued?.run?.outcome).toBe("completed");
    expect(await Bun.file(join(dirs.cwd, "uncertain-effect.txt")).text()).toBe(
      "externally reconciled",
    );
    expect(
      fake.contexts.some((context) =>
        JSON.stringify(context.messages).includes("may have partially run"),
      ),
    ).toBe(true);
  } finally {
    await parent.close();
  }
});
