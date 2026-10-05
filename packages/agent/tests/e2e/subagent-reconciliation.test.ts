import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { branchTip } from "@earendil-works/pi-agent-core/harness/session";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createSession, type SubagentIdentity } from "../../src/index.ts";
import { crashedSubagents } from "../helpers/crashed-subagents.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("parent resume reads pending child facts: saved endings win and only a reliable unclosed Run is interrupted", async () => {
  dirs = await tempDirs();
  const fixture = await crashedSubagents(dirs);
  const pending = await fixture.child("Interrupted reader");
  await fixture.child("Already finished", "completed");
  const failed = await fixture.child("Provider failed", "error");
  await fixture.save();
  const fake = fakeModel([fauxAssistantMessage("checked")]);
  const session = await createSession({ ...dirs, ...fake, resumeId: fixture.parentId });
  try {
    expect(fake.contexts).toHaveLength(0);
    expect(session.running).toBe(false);
    expect(session.checkpoints()).toEqual([]);
    expect(session.recovery.subagents).toMatchObject([
      { id: pending.metadata.id, runId: pending.run.id, outcome: "interrupted" },
      { id: failed.metadata.id, outcome: "error", reason: "durable failure" },
    ]);
    expect(session.recovery.subagents).toHaveLength(2);
    await session.run("inspect saved work");
    const messages = JSON.stringify(fake.contexts[0]!.messages);
    expect(messages).toContain(`${pending.metadata.id} (Interrupted reader): interrupted`);
    expect(messages).toContain("durable failure");
    expect(messages).not.toContain("Already finished");
    expect(session.checkpoints()).toHaveLength(1);
  } finally {
    await session.dispose();
  }
});

function nativePath(metadata: object): string {
  const path = Reflect.get(metadata, "path");
  if (typeof path !== "string") throw new Error("Native Session path missing.");
  return path;
}

test("missing, corrupt and unreadable children remain unconfirmed while valid siblings and the parent continue; bytes never change", async () => {
  dirs = await tempDirs();
  const fixture = await crashedSubagents(dirs);
  const good = await fixture.child("Readable");
  const broken = [];
  for (const kind of ["missing", "header", "body", "torn", "unreadable"])
    broken.push(await fixture.child(kind));
  await fixture.save();
  const { unlink, appendFile, chmod } = await import("node:fs/promises");
  await unlink(nativePath(broken[0]!.metadata));
  await Bun.write(nativePath(broken[1]!.metadata), "invalid header\n");
  await appendFile(nativePath(broken[2]!.metadata), "invalid body\n");
  await appendFile(nativePath(broken[3]!.metadata), '{"torn":');
  const baseline = await Promise.all(
    broken.slice(1).map((child) => Bun.file(nativePath(child.metadata)).bytes()),
  );
  await chmod(nativePath(broken[4]!.metadata), 0);
  const fake = fakeModel([fauxAssistantMessage("parent usable")]);
  try {
    const parent = await createSession({ ...dirs, ...fake, resumeId: fixture.parentId });
    try {
      expect(parent.recovery.subagents).toMatchObject([
        { id: good.metadata.id, outcome: "interrupted" },
        ...broken.map((child) => ({
          id: child.metadata.id,
          outcome: "unknown",
          diagnostic: "unconfirmed",
        })),
      ]);
      expect(fake.contexts).toHaveLength(0);
      expect(parent.checkpoints()).toEqual([]);
      await parent.run("continue parent");
      expect(JSON.stringify(fake.contexts[0]!.messages)).toContain(
        "unable to confirm the saved child Run",
      );
      expect(parent.checkpoints()).toHaveLength(1);
    } finally {
      await parent.dispose();
    }
  } finally {
    await chmod(nativePath(broken[4]!.metadata), 0o600);
  }
  for (const [index, child] of broken.slice(1).entries())
    expect(await Bun.file(nativePath(child.metadata)).bytes()).toEqual(baseline[index]!);
});

test("only pending children are discovered and opened read-only; observers release each Session before returning", async () => {
  dirs = await tempDirs();
  const fixture = await crashedSubagents(dirs);
  const pending = await fixture.child("Pending");
  for (let index = 0; index < 25; index++) {
    const settled = await fixture.child(`Settled ${index}`, "completed");
    fixture.identities.at(-1)!.latestRun = { ...settled.run, endedAt: 20, outcome: "completed" };
  }
  fixture.identities.push({ id: "legacy", description: "Legacy", type: "general-purpose" });
  await fixture.save();
  const found: string[] = [],
    observed: string[] = [],
    closed: string[] = [];
  const store = fixture.store;
  const tracked = {
    ...store,
    async list(): Promise<never> {
      throw new Error("Full header scans are forbidden.");
    },
    async find(...args: Parameters<NonNullable<typeof store.find>>) {
      found.push(args[0]);
      return store.find!(...args);
    },
    async openReadonly(...args: Parameters<NonNullable<typeof store.openReadonly>>) {
      observed.push(args[0].id);
      const child = await store.openReadonly!(...args);
      const close = child.close.bind(child);
      child.close = async (context) => {
        await close(context);
        closed.push(child.metadata.id);
      };
      return child;
    },
  };
  const parent = await createSession({
    ...dirs,
    ...fakeModel([]),
    store: tracked,
    resumeId: fixture.parentId,
  });
  try {
    expect(found).toEqual([fixture.parentId, pending.metadata.id]);
    expect(observed).toEqual([pending.metadata.id]);
    expect(closed).toEqual(observed);
    expect(parent.recovery.subagents.map((row) => row.outcome)).toEqual(["interrupted", "unknown"]);
    // Same real repo rejects double-open: reopening proves the observation released it.
    const child = await store.openReadonly!(pending.metadata, BACKGROUND_CONTEXT);
    await child.close(BACKGROUND_CONTEXT);
  } finally {
    await parent.dispose();
  }
});

test("opaque injected Store compatibility never assumes an ordinary child open is read-only", async () => {
  dirs = await tempDirs();
  const fixture = await crashedSubagents(dirs);
  const pending = await fixture.child("Opaque");
  await fixture.save();
  let opened = 0;
  const opaque = {
    create: fixture.store.create,
    list: fixture.store.list,
    async open(...args: Parameters<typeof fixture.store.open>) {
      opened++;
      return fixture.store.open(...args);
    },
  };
  const parent = await createSession({
    ...dirs,
    ...fakeModel([]),
    store: opaque,
    resumeId: fixture.parentId,
  });
  try {
    expect(opened).toBe(1);
    expect(parent.recovery.subagents).toMatchObject([
      { id: pending.metadata.id, outcome: "unknown", diagnostic: "unconfirmed" },
    ]);
  } finally {
    await parent.dispose();
  }
});

test("second Run start never borrows the first completion and a removed branch ending cannot settle it", async () => {
  dirs = await tempDirs();
  const fixture = await crashedSubagents(dirs);
  const child = await fixture.child("Second attempt", "completed");
  const stored = await fixture.store.open(child.metadata, BACKGROUND_CONTEXT);
  const branch = (await stored.branch("main", BACKGROUND_CONTEXT))!;
  const second = { ...child.run, id: "second-run", startedAt: 30 };
  await branch.appendCustomEntry(
    "tool-state/subagent-run",
    { version: 1, value: second },
    BACKGROUND_CONTEXT,
  );
  const tip = await branch.getTipId(BACKGROUND_CONTEXT);
  await branch.appendCustomEntry(
    "tool-state/subagent-run",
    { version: 1, value: { ...second, endedAt: 40, outcome: "completed" } },
    BACKGROUND_CONTEXT,
  );
  await stored.createBranch(
    "discarded",
    await branch.getTipId(BACKGROUND_CONTEXT),
    BACKGROUND_CONTEXT,
  );
  await stored.setValue(branchTip("main"), tip, BACKGROUND_CONTEXT);
  await stored.close(BACKGROUND_CONTEXT);
  fixture.identities[0]!.latestRun = second;
  await fixture.save();
  const before = await Bun.file(nativePath(child.metadata)).bytes();
  const parent = await createSession({ ...dirs, ...fakeModel([]), resumeId: fixture.parentId });
  try {
    expect(parent.recovery.subagents).toMatchObject([
      { id: child.metadata.id, runId: "second-run", outcome: "interrupted" },
    ]);
    expect(await Bun.file(nativePath(child.metadata)).bytes()).toEqual(before);
  } finally {
    await parent.dispose();
  }
});

for (const mismatch of ["run", "child", "parent", "header", "start", "branch"] as const)
  test(`${mismatch} association mismatch stays unconfirmed rather than inventing interruption`, async () => {
    dirs = await tempDirs();
    const fixture = await crashedSubagents(dirs);
    const child = await fixture.child("Uncertain");
    const stored = await fixture.store.open(child.metadata, BACKGROUND_CONTEXT);
    const branch = (await stored.branch("main", BACKGROUND_CONTEXT))!;
    if (mismatch === "branch") await stored.setValue(branchTip("main"), null, BACKGROUND_CONTEXT);
    else if (mismatch !== "header")
      await branch.appendCustomEntry(
        "tool-state/subagent-run",
        {
          version: 1,
          value: {
            ...child.run,
            ...(mismatch === "run" && { id: "other-run" }),
            ...(mismatch === "child" && { sessionId: "other-child" }),
            ...(mismatch === "parent" && { parentSessionId: "other-parent" }),
            ...(mismatch === "start" && { startedAt: 999 }),
          },
        },
        BACKGROUND_CONTEXT,
      );
    await stored.close(BACKGROUND_CONTEXT);
    if (mismatch === "header") {
      const path = nativePath(child.metadata);
      const text = await Bun.file(path).text();
      await Bun.write(
        path,
        text.replace(
          `"parentSessionId":"${fixture.parentId}"`,
          '"parentSessionId":"foreign-parent"',
        ),
      );
    }
    await fixture.save();
    const parent = await createSession({
      ...dirs,
      ...fakeModel([]),
      store: fixture.store,
      resumeId: fixture.parentId,
    });
    try {
      expect(parent.recovery.subagents).toMatchObject([
        { outcome: "unknown", diagnostic: "unconfirmed" },
      ]);
    } finally {
      await parent.dispose();
    }
    const released = await fixture.store.openReadonly!(child.metadata, BACKGROUND_CONTEXT);
    await released.close(BACKGROUND_CONTEXT);
  });

test("send_message after interruption reuses child history, repairs orphan calls only then, and writes under the real parent Checkpoint", async () => {
  dirs = await tempDirs();
  const fixture = await crashedSubagents(dirs);
  const child = await fixture.child("Continue reader");
  const stored = await fixture.store.open(child.metadata, BACKGROUND_CONTEXT);
  const branch = (await stored.branch("main", BACKGROUND_CONTEXT))!;
  await branch.appendMessage(fauxAssistantMessage("saved exploration"), BACKGROUND_CONTEXT);
  await branch.appendMessage(
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "printf replay >> effect.txt" }, { id: "orphan" }),
      { stopReason: "toolUse" },
    ),
    BACKGROUND_CONTEXT,
  );
  await stored.close(BACKGROUND_CONTEXT);
  await fixture.save();
  const before = await Bun.file(nativePath(child.metadata)).bytes();
  let childCalls = 0;
  const reply: Parameters<typeof fakeModel>[0][number] = (context) => {
    if (
      getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
        (tool) => tool.name === "subagent",
      )
    )
      return fauxAssistantMessage("parent waits");
    childCalls++;
    expect(JSON.stringify(context.messages)).toContain("saved exploration");
    expect(JSON.stringify(context.messages)).toContain("new instruction");
    expect(
      context.messages.find(
        (message) => message.role === "toolResult" && message.toolCallId === "orphan",
      ),
    ).toMatchObject({ details: { recovery: { type: "unknown-tool-outcome" } } });
    return fauxAssistantMessage(
      fauxToolCall("write", { path: "continued.txt", content: "continued" }),
      { stopReason: "toolUse" },
    );
  };
  const finish: Parameters<typeof fakeModel>[0][number] = (context) =>
    getCurrentSystemMessage(context.messages)?.toolsAdded?.some((tool) => tool.name === "subagent")
      ? fauxAssistantMessage("parent done")
      : fauxAssistantMessage("child done");
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("send_message", { agent_id: child.metadata.id, message: "new instruction" }),
      { stopReason: "toolUse" },
    ),
    reply,
    reply,
    finish,
    finish,
    finish,
  ]);
  fake.model.contextWindow = 100000;
  const parent = await createSession({
    ...dirs,
    ...fake,
    resumeId: fixture.parentId,
    permissionMode: "full-access",
  });
  try {
    expect(parent.recovery.subagents).toMatchObject([{ outcome: "interrupted" }]);
    expect(fake.contexts).toHaveLength(0);
    expect(await Bun.file(nativePath(child.metadata)).bytes()).toEqual(before);
    expect(parent.checkpoints()).toHaveLength(0);
    const ids: string[] = [];
    expect(
      (
        await parent.run("continue child", {
          onEvent(event) {
            if (event.type === "subagent_event") ids.push(event.agentId);
          },
        })
      ).success,
    ).toBe(true);
    expect(new Set(ids)).toEqual(new Set([child.metadata.id]));
    expect(childCalls).toBe(1);
    const latest = (parent.toolState("subagents") as SubagentIdentity[])[0]!.latestRun!;
    expect(latest.id).not.toBe(child.run.id);
    expect(latest.outcome).toBe("completed");
    expect(await Bun.file(join(dirs.cwd, "effect.txt")).exists()).toBe(false);
    expect(await Bun.file(join(dirs.cwd, "continued.txt")).text()).toBe("continued");
    expect(parent.checkpoints()).toMatchObject([
      {
        preview: "continue child",
        files: [{ path: expect.stringContaining("continued.txt"), backup: null }],
      },
    ]);
    await parent.rewind(parent.checkpoints()[0]!.promptEntryId, { code: true, conversation: true });
    expect(await Bun.file(join(dirs.cwd, "continued.txt")).exists()).toBe(false);
    expect(parent.recovery.subagents).toMatchObject([
      { outcome: "unknown", diagnostic: "unconfirmed" },
    ]);
  } finally {
    await parent.dispose();
  }
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: fixture.parentId });
  try {
    expect(resumed.recovery.subagents).toMatchObject([
      { outcome: "unknown", diagnostic: "unconfirmed" },
    ]);
  } finally {
    await resumed.dispose();
  }
});

test("native fork inheritance cannot impersonate the fork's own child Run facts", async () => {
  dirs = await tempDirs();
  const fixture = await crashedSubagents(dirs);
  await fixture.save();
  const metadata = (await fixture.store.find!(
    fixture.parentId,
    { cwd: dirs.cwd },
    BACKGROUND_CONTEXT,
  ))!;
  const source = await fixture.store.open(metadata, BACKGROUND_CONTEXT);
  const copiedRun = {
    id: "copied-run",
    sessionId: fixture.parentId,
    parentSessionId: fixture.parentId,
    startedAt: 10,
  };
  await (await source.branch("main", BACKGROUND_CONTEXT))!.appendCustomEntry(
    "tool-state/subagent-run",
    { version: 1, value: { ...copiedRun, endedAt: 20, outcome: "completed" } },
    BACKGROUND_CONTEXT,
  );
  await source.close(BACKGROUND_CONTEXT);
  const { JsonlSessionRepo } = await import("@earendil-works/pi-agent-core/harness/session");
  const { NodeExecutionEnv } = await import("@earendil-works/pi-agent-core/harness/env/nodejs");
  const repo = new JsonlSessionRepo({
    fileSystem: new NodeExecutionEnv({ cwd: dirs.cwd }),
    sessionsRoot: join(dirs.homeDir, ".neant/sessions"),
  });
  const native = (await repo.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT)).find(
    (row) => row.id === fixture.parentId,
  )!;
  const fork = await repo.fork(native, { scope: "tree" }, BACKGROUND_CONTEXT);
  await fork.close(BACKGROUND_CONTEXT);
  const parentStore = await fixture.store.open(metadata, BACKGROUND_CONTEXT);
  await (await parentStore.branch("main", BACKGROUND_CONTEXT))!.appendCustomEntry(
    "tool-state/subagents",
    {
      version: 2,
      value: [
        {
          id: fork.metadata.id,
          description: "Forked",
          type: "fork",
          latestRun: { ...copiedRun, sessionId: fork.metadata.id },
        },
      ],
    },
    BACKGROUND_CONTEXT,
  );
  await parentStore.close(BACKGROUND_CONTEXT);
  const parent = await createSession({ ...dirs, ...fakeModel([]), resumeId: fixture.parentId });
  try {
    expect(parent.recovery.subagents).toMatchObject([
      { id: fork.metadata.id, outcome: "unknown", diagnostic: "unconfirmed" },
    ]);
    expect(parent.recovery.subagents).toHaveLength(1);
  } finally {
    await parent.dispose();
    await repo.close(BACKGROUND_CONTEXT);
  }
});
