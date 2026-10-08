import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());
test.each(["new", "overwrite", "large"])(
  "write %s persists review facts and reproduces its diff on resume",
  async (mode) => {
    dirs = await tempDirs();
    const oldText =
      mode === "new"
        ? null
        : mode === "large"
          ? `${"unchanged\n".repeat(12000)}before\n`
          : "before\n";
    const content = mode === "large" ? `${"unchanged\n".repeat(12000)}after\n` : "after\n";
    if (oldText !== null) await Bun.write(join(dirs.cwd, "file.txt"), oldText);
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    const events: SessionEvent[] = [];
    await session.run("write", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const end = events.find((event) => event.type === "tool_execution_end");
    expect(end).toMatchObject({ view: { card: "diff", kind: "edit", displayKey: "tool.write" } });
    const result = session.messages.find((message) => message.role === "toolResult");
    if (mode === "large") {
      expect(result).toMatchObject({
        details: { patch: expect.stringContaining("-before\n+after") },
      });
      expect(JSON.stringify(result)).not.toContain("oldText");
      expect(JSON.stringify(result).length).toBeLessThan(3000);
    } else expect(result).toMatchObject({ details: { oldText, newText: content } });
    await session.close();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.messages.find((message) => message.role === "toolResult")).toMatchObject({
      view: end?.type === "tool_execution_end" ? end.view : undefined,
    });
    await resumed.close();
  },
);
test("edit publishes pending replacements and the actual successful unified patch", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "before\n");
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("edit", {
          path: "file.txt",
          edits: [{ oldText: "before", newText: "after" }],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]),
    permissionMode: "full-access",
  });
  const events: SessionEvent[] = [];
  await session.run("edit", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.find((event) => event.type === "tool_execution_start")).toMatchObject({
    view: {
      card: "diff",
      diffs: [{ path: join(dirs.cwd, "file.txt"), oldText: "before", newText: "after" }],
    },
  });
  expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
    view: {
      card: "diff",
      diffs: [
        { path: join(dirs.cwd, "file.txt"), patch: expect.stringContaining("-before\n+after") },
      ],
    },
  });
  await session.close();
});

test("failed file tools preserve errors without claiming a successful diff", async () => {
  dirs = await tempDirs();
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("write", { path: ".", content: "cannot overwrite directory" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("edit", {
          path: "missing.txt",
          edits: [{ oldText: "before", newText: "after" }],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("recovered"),
    ]),
    permissionMode: "full-access",
  });
  const events: SessionEvent[] = [];
  await session.run("try invalid files", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const ends = events.filter((event) => event.type === "tool_execution_end");
  expect(ends).toHaveLength(2);
  for (const end of ends) {
    expect(end.result?.isError).toBe(true);
    expect(end.view).toBeUndefined();
  }
  await session.close();
});

test("reused provider call IDs preserve each committed result's chronological file view", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "first.txt"), "one\ntwo\nthree\n");
  await Bun.write(join(dirs.cwd, "second.txt"), "alpha\nbeta\ngamma\ndelta\n");
  const call = (name: string, args: Record<string, import("@earendil-works/chord").JsonValue>) =>
    fauxAssistantMessage(fauxToolCall(name, args, { id: "reused-id" }), { stopReason: "toolUse" });
  const fake = fakeModel([
    call("read", { path: "first.txt", offset: 2, limit: 1 }),
    call("read", { path: "second.txt", offset: 3, limit: 1 }),
    call("bash", { command: "printf other-tool", description: "Different tool same ID" }),
    fauxAssistantMessage("finished"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  const events: SessionEvent[] = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
  });
  function check(messages: readonly import("../../src/index.ts").TranscriptMessage[]) {
    const reads = messages.filter(
      (message) => message.role === "toolResult" && message.toolName === "read",
    );
    expect(reads).toHaveLength(2);
    expect(reads[0]).toMatchObject({ view: { card: "read", path: "first.txt", offset: 2 } });
    expect(reads[1]).toMatchObject({ view: { card: "read", path: "second.txt", offset: 3 } });
  }
  try {
    await session.run("read two different slices then run another tool");
    check(session.messages);
    const delivered: SessionEvent[] = [];
    const stop = session.subscribe((event) => {
      delivered.push(event);
    });
    stop();
    const snapshot = delivered.find((event) => event.type === "snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("Missing public snapshot");
    check(snapshot.messages);
    const endings = events
      .filter((event) => event.type === "message_end")
      .flatMap((event) => event.messages);
    check(endings);
    expect(fake.contexts).toHaveLength(4);
    await session.close();
    const cold = fakeModel([]);
    const resumed = await createSession({ ...dirs, ...cold, resumeId: session.id });
    try {
      check(resumed.messages);
      expect(cold.contexts).toHaveLength(0);
    } finally {
      await resumed.close();
    }
  } finally {
    unsubscribe();
    await session.close();
  }
});

test("fresh child presentation preserves chronological views when a provider reuses call IDs", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "child-first.txt"), "one\ntwo\nthree\n");
  await Bun.write(join(dirs.cwd, "child-second.txt"), "alpha\nbeta\ngamma\n");
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Reader",
        prompt: "child reads",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("read", { path: "child-first.txt", offset: 2, limit: 1 }, { id: "repeated" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("read", { path: "child-second.txt", offset: 3, limit: 1 }, { id: "repeated" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall(
        "bash",
        { command: "printf child-other", description: "Other tool" },
        { id: "repeated" },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child complete"),
    fauxAssistantMessage("parent complete"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  let childId = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "subagent_event") childId = event.agentId;
  });
  async function check(owner: typeof session) {
    const child = await owner.readSubagent(childId);
    const reads = child?.messages.filter(
      (message) => message.role === "toolResult" && message.toolName === "read",
    );
    expect(reads).toHaveLength(2);
    expect(reads?.[0]).toMatchObject({
      view: { card: "read", path: "child-first.txt", offset: 2 },
    });
    expect(reads?.[1]).toMatchObject({
      view: { card: "read", path: "child-second.txt", offset: 3 },
    });
  }
  try {
    await session.run("delegate reader");
    await check(session);
    expect(fake.contexts).toHaveLength(6);
    await session.close();
    const cold = fakeModel([]);
    const restored = await createSession({ ...dirs, ...cold, resumeId: session.id });
    try {
      await check(restored);
      expect(cold.contexts).toHaveLength(0);
    } finally {
      await restored.close();
    }
  } finally {
    unsubscribe();
    await session.close();
  }
});
