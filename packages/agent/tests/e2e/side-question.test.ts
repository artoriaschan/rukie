import { afterEach, expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import { abortingModel } from "../helpers/aborting-model.ts";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { sideModel } from "../helpers/side-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());
async function answer(parts: AsyncIterable<string>) {
  let text = "";
  for await (const part of parts) text += part;
  return text;
}

test("side questions stream visible text from a snapshot without tools or Session side effects", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage('{"ok":true}'),
    fauxAssistantMessage("Widget behavior already inspected."),
  ]);
  const side = sideModel(fake.streamFn);
  let reminderReads = 0;
  const session = await createSession({
    ...dirs,
    ...fake,
    streamFn: side.streamFn,
    settings: {
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "prompt", prompt: "Review $ARGUMENTS" }] }] },
    },
    reminderSources: [
      {
        source: "external",
        currentContent: () => {
          reminderReads++;
          return "Existing reminder.";
        },
      },
    ],
  });
  await session.run("inspect widgets");
  const before = structuredClone(session.messages);
  const reads = reminderReads;
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  const pending = answer(session.sideQuestion("What do we know?"));
  await side.started;
  const call = side.calls[0]!;
  expect(JSON.stringify(call.context)).toContain("Widget behavior already inspected.");
  expect(JSON.stringify(call.context)).toContain("Existing reminder.");
  expect(JSON.stringify(call.context)).toContain("<side-question-context>");
  expect(getCurrentTools(call.context.messages)).toEqual([]);
  for (const message of call.context.messages) {
    if (message.role === "system") {
      expect(message.toolsAdded).toBeUndefined();
      expect(message.toolsRemoved).toBeUndefined();
    }
  }
  call.thinking("private reasoning");
  call.delta("Already ");
  call.delta("known.");
  call.finish();
  expect(await pending).toBe("Already known.");
  expect(session.messages).toEqual(before);
  expect(events).toEqual([]);
  expect(reminderReads).toBe(reads);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(before);
  expect(fake.contexts).toHaveLength(2);
  await session.dispose();
  await resumed.dispose();
});

test("ending iteration cancels only the auxiliary provider and invalid or failed requests stay out of history", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([]);
  const side = sideModel(fake.streamFn);
  const session = await createSession({ ...dirs, ...fake, streamFn: side.streamFn });
  const before = structuredClone(session.messages);
  expect(() => session.sideQuestion(" \n ")).toThrow("empty");
  const aborted = new AbortController();
  aborted.abort(new Error("already cancelled"));
  await expect(
    answer(session.sideQuestion("never dispatched", { signal: aborted.signal })),
  ).rejects.toThrow("already cancelled");
  expect(side.calls).toHaveLength(0);
  const iterator = session.sideQuestion("a streamed answer")[Symbol.asyncIterator]();
  const first = iterator.next();
  await side.started;
  side.calls[0]!.delta("Visible.");
  expect(await first).toEqual({ value: "Visible.", done: false });
  await iterator.return!();
  expect(side.calls[0]!.signal!.aborted).toBe(true);
  const failed = answer(session.sideQuestion("failed provider"));
  void failed.catch(() => {});
  // The synchronous injected provider is reached before the generator's first await.
  side.calls[1]!.fail("Side provider unavailable");
  await expect(failed).rejects.toThrow("Side provider unavailable");
  const empty = answer(session.sideQuestion("empty answer"));
  void empty.catch(() => {});
  side.calls[2]!.finish();
  await expect(empty).rejects.toThrow("No response");
  expect(session.messages).toEqual(before);
  expect(fake.contexts).toHaveLength(0);
  await session.dispose();
});

test("resumed history keeps answered calls but drops stale unresolved calls and every historical tool delta", async () => {
  dirs = await tempDirs();
  const store = new MemorySessionRepo();
  const stored = await store.create({}, BACKGROUND_CONTEXT);
  const branch = await stored.createBranch("main", null, BACKGROUND_CONTEXT);
  await branch.appendMessage(
    {
      role: "system",
      content: "Historical policy.",
      toolsAdded: [
        { name: "old", description: "old tool", parameters: { type: "object", properties: {} } },
      ],
      timestamp: 1,
    },
    BACKGROUND_CONTEXT,
  );
  await branch.appendMessage(
    {
      role: "system",
      content: "Later policy.",
      toolsAdded: [
        { name: "new", description: "new tool", parameters: { type: "object", properties: {} } },
      ],
      toolsRemoved: [{ name: "old" }],
      timestamp: 2,
    },
    BACKGROUND_CONTEXT,
  );
  await branch.appendMessage(
    fauxAssistantMessage([
      fauxToolCall("read", { path: "known.txt" }, { id: "answered" }),
      fauxToolCall("bash", { command: "stale work" }, { id: "stale" }),
    ]),
    BACKGROUND_CONTEXT,
  );
  await branch.appendMessage(
    {
      role: "toolResult",
      toolCallId: "answered",
      toolName: "read",
      content: [{ type: "text", text: "Known file result." }],
      isError: false,
      timestamp: 3,
    },
    BACKGROUND_CONTEXT,
  );
  await stored.close(BACKGROUND_CONTEXT);
  const fake = fakeModel([]);
  const side = sideModel(fake.streamFn);
  const session = await createSession({
    ...dirs,
    ...fake,
    streamFn: side.streamFn,
    store,
    resumeId: stored.metadata.id,
  });
  const pending = answer(session.sideQuestion("What was read?"));
  await side.started;
  const context = side.calls[0]!.context;
  expect(JSON.stringify(context)).toContain("Known file result.");
  expect(JSON.stringify(context)).toContain('"id":"answered"');
  expect(JSON.stringify(context)).not.toContain('"id":"stale"');
  expect(JSON.stringify(context)).not.toContain("stale work");
  expect(JSON.stringify(context)).toContain("Tool outcome unknown");
  expect(JSON.stringify(context)).toContain("not a real Tool result");
  expect(JSON.stringify(context)).not.toContain("still executing");
  expect(JSON.stringify(context)).not.toContain("toolsAdded");
  expect(JSON.stringify(context)).not.toContain("toolsRemoved");
  side.calls[0]!.delta("Known result.");
  side.calls[0]!.finish();
  expect(await pending).toBe("Known result.");
  expect(JSON.stringify(session.messages)).toContain('"id":"stale"');
  await session.dispose();
});

test("side questions snapshot the restored compaction context before later main messages", async () => {
  dirs = await tempDirs();
  const original = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage("OLD_HISTORY_REMOVED"),
      fauxAssistantMessage("Restored widget summary."),
    ]),
  });
  await original.run("old main prompt");
  await original.compact();
  await original.dispose();
  const fake = fakeModel([fauxAssistantMessage("LATER_MAIN_RESPONSE")]);
  const side = sideModel(fake.streamFn);
  const session = await createSession({
    ...dirs,
    ...fake,
    streamFn: side.streamFn,
    resumeId: original.id,
  });
  const snapshot = session.sideQuestion("What did the summary retain?");
  await session.run("LATER_MAIN_PROMPT");
  const pending = answer(snapshot);
  await side.started;
  const context = JSON.stringify(side.calls[0]!.context);
  expect(context).toContain("Restored widget summary.");
  expect(context).not.toContain("OLD_HISTORY_REMOVED");
  expect(context).not.toContain("LATER_MAIN_PROMPT");
  expect(context).not.toContain("LATER_MAIN_RESPONSE");
  side.calls[0]!.delta("Summary retained widgets.");
  side.calls[0]!.finish();
  expect(await pending).toBe("Summary retained widgets.");
  await session.dispose();
});

test("Session disposal cancels an active side iterator without requiring a caller signal", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([]);
  const side = sideModel(fake.streamFn);
  const session = await createSession({ ...dirs, ...fake, streamFn: side.streamFn });
  const pending = answer(session.sideQuestion("pending during close"));
  void pending.catch(() => {});
  await side.started;
  try {
    await session.dispose();
    expect(side.calls[0]!.signal!.aborted).toBe(true);
    await expect(pending).rejects.toThrow();
    expect(() => session.sideQuestion("after close")).toThrow("disposed");
  } finally {
    side.calls[0]!.finish();
    await pending.catch(() => {});
    await session.dispose();
  }
});

test("cancelling a side request settles even while its asynchronous provider setup ignores abort", async () => {
  dirs = await tempDirs();
  const fake = abortingModel();
  const started = Promise.withResolvers<void>();
  const setup = Promise.withResolvers<ReturnType<typeof createAssistantMessageEventStream>>();
  const session = await createSession({
    ...dirs,
    ...fake,
    streamFn: (model, context, options) => {
      const last = context.messages.at(-1);
      if (
        last?.role === "user" &&
        JSON.stringify(last.content).includes("<side-question-context>")
      ) {
        started.resolve();
        return setup.promise;
      }
      return fake.streamFn(model, context, options);
    },
  });
  const run = session.run("ongoing main task");
  void run.catch(() => {});
  await fake.started;
  const controller = new AbortController();
  const pending = answer(session.sideQuestion("cancel this side", { signal: controller.signal }));
  void pending.catch(() => {});
  try {
    await started.promise;
    controller.abort(new Error("cancel side only"));
    await expect(pending).rejects.toThrow("cancel side only");
    expect(session.running).toBe(true);
  } finally {
    const stream = createAssistantMessageEventStream();
    const message = fauxAssistantMessage("unused");
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    setup.resolve(stream);
    session.interruptRun();
    await run.catch(() => {});
    await session.dispose();
  }
});

test("an active side question removes unresolved calls and names the independently running tools", async () => {
  dirs = await tempDirs();
  const args = { command: "x".repeat(385) + "😀😀😀😀😀\n do later" };
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        { type: "text", text: "Main task has started." },
        fauxToolCall("bash", args, { id: "pending-bash" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Main task finished."),
  ]);
  const side = sideModel(fake.streamFn);
  const requested = Promise.withResolvers<void>();
  const permission = Promise.withResolvers<"deny">();
  const session = await createSession({
    ...dirs,
    ...fake,
    streamFn: side.streamFn,
    onPermissionAsk: () => {
      requested.resolve();
      return permission.promise;
    },
  });
  const run = session.run("continue the main task");
  await requested.promise;
  const pending = answer(session.sideQuestion("Which results are available?"));
  await side.started;
  const request = side.calls[0]!;
  expect(
    request.context.messages.some(
      (message) =>
        message.role === "assistant" && message.content.some((block) => block.type === "toolCall"),
    ),
  ).toBe(false);
  expect(JSON.stringify(request.context)).toContain("Main task has started.");
  const last = request.context.messages.at(-1)!;
  if (last.role !== "user" || typeof last.content === "string" || last.content[0]?.type !== "text")
    throw new Error("Expected wrapped user question");
  const wrapper = last.content[0].text;
  expect(wrapper).toContain(
    "The main task is still executing these tool calls; their results are not available yet:",
  );
  expect(wrapper).toContain("- bash ");
  const bullet = wrapper.split("\n").find((line) => line.startsWith("- bash "))!;
  expect(bullet.length).toBeLessThanOrEqual(408);
  expect(bullet).toEndWith("…");
  expect(bullet).not.toMatch(/[\ud800-\udbff]…$/);
  expect(wrapper).not.toContain("do later");
  request.delta("Still pending.");
  request.finish();
  expect(await pending).toBe("Still pending.");
  expect(session.running).toBe(true);
  permission.resolve("deny");
  expect((await run).text).toBe("Main task finished.");
  expect(fake.contexts).toHaveLength(2);
  await session.dispose();
});
