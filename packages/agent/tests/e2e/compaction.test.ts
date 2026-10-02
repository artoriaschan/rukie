import { afterEach, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { abortingModel } from "../helpers/aborting-model.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("only a Turn above the context threshold compacts before answering", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Preserve the widget contract.");
  const fake = fakeModel([
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage("Summary of old work."),
    fauxAssistantMessage("continued"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
    if (event.type === "compaction_start") expect(fake.contexts).toHaveLength(1);
    if (event.type === "compaction_end") expect(fake.contexts).toHaveLength(2);
  };

  await session.run("start", { onEvent });
  expect(
    events.filter((event) => event.type === "compaction_start" || event.type === "compaction_end"),
  ).toEqual([]);
  expect(fake.contexts).toHaveLength(1);

  const result = await session.run("continue", { onEvent });
  expect(result.text).toBe("continued");
  const compactions = events.filter(
    (event) => event.type === "compaction_start" || event.type === "compaction_end",
  );
  expect(compactions).toEqual([
    { type: "compaction_start", sessionId: session.id, tokensBefore: expect.any(Number) },
    {
      type: "compaction_end",
      sessionId: session.id,
      summary: expect.stringContaining("Summary of old work."),
      tokensBefore: expect.any(Number),
      tokensAfter: expect.any(Number),
    },
  ]);
  const ended = compactions.find((event) => event.type === "compaction_end")!;
  expect(compactions[0]).toMatchObject({ tokensBefore: ended.tokensBefore });
  expect(ended.tokensAfter).toBeLessThan(ended.tokensBefore);
  expect(JSON.stringify(fake.contexts[1])).toContain("old work");
  expect(JSON.stringify(fake.contexts[1])).toContain("Preserve the widget contract.");
  expect(JSON.stringify(fake.contexts[2])).toContain("Summary of old work.");
  expect(JSON.stringify(fake.contexts[2])).not.toContain("old work old work");
  expect(fake.contexts[2]!.messages.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "continue" }],
  });
});

test("a request above the threshold emits no compaction events when no work remains to compress", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage("Summary of old work."),
    fauxAssistantMessage("answered"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  await session.run("first");
  // Leave the Transcript at a completed compaction, before any new model work.
  await expect(
    session.run("compact", {
      onEvent: (event) => {
        if (event.type === "compaction_end") throw new Error("pause after compaction");
      },
    }),
  ).rejects.toThrow("pause after compaction");
  const events: SessionEvent[] = [];
  const result = await session.run("pending request ".repeat(2500), {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(result.text).toBe("answered");
  expect(fake.contexts).toHaveLength(3);
  expect(
    events.filter((event) => event.type === "compaction_start" || event.type === "compaction_end"),
  ).toEqual([]);
});

test("compaction appends a native Transcript entry and resume restores summary plus suffix", async () => {
  dirs = await tempDirs();
  const original = "original reply ".repeat(2000);
  const fake = fakeModel([
    fauxAssistantMessage(original),
    fauxAssistantMessage("Saved summary."),
    fauxAssistantMessage("after summary"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  await session.run("original prompt");
  const before = await transcript();
  const events: SessionEvent[] = [];
  await session.run("next prompt", {
    onEvent: async (event) => {
      events.push(event);
      if (event.type === "compaction_end")
        expect(await transcript()).toContain('"type":"compaction"');
    },
  });
  const after = await transcript();
  expect(after).toStartWith(before);
  expect(after).toContain(original);
  const records = after
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const compacted = records
    .flatMap((record) => (Array.isArray(record) ? record : []))
    .find((write) => write.kind === "entry" && write.type === "compaction");
  expect(compacted).toMatchObject({
    summary: expect.stringContaining("Saved summary."),
    retainedTail: [{ role: "user", content: [{ type: "text", text: "next prompt" }] }],
  });
  const next = fakeModel([fauxAssistantMessage("resumed")]);
  next.model.contextWindow = 4000;
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
  expect(JSON.stringify(resumed.messages)).toContain("Saved summary.");
  expect(JSON.stringify(resumed.messages)).not.toContain(original);
  const resumedEvents: SessionEvent[] = [];
  await resumed.run("resume prompt", {
    onEvent: (event) => {
      resumedEvents.push(event);
    },
  });
  expect(next.contexts[0]!.messages.slice(0, -2)).toEqual(fake.contexts.at(-1)!.messages);
  expect(next.contexts[0]!.messages.slice(-2)).toMatchObject([
    { role: "assistant", content: [{ type: "text", text: "after summary" }] },
    { role: "user", content: [{ type: "text", text: "resume prompt" }] },
  ]);
  expect(resumedEvents.filter((event) => event.type === "reminder_injected")).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: "result", success: true });
});

test("a large tool result compacts before the next Turn within the same Run", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "large.txt"), "tool output ".repeat(2500));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "large.txt" }, { id: "read-1" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("The file contained large tool output."),
    fauxAssistantMessage("finished"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  const events: SessionEvent[] = [];
  expect(
    (
      await session.run("read the file", {
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).text,
  ).toBe("finished");
  expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
  expect(JSON.stringify(fake.contexts[1])).toContain("tool output tool output");
  expect(JSON.stringify(fake.contexts.at(-1))).not.toContain("tool output tool output");
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("The file contained large tool output.");
});

test("an injected Session Store resumes through multiple compactions using the previous summary", async () => {
  dirs = await tempDirs();
  const store = new MemorySessionRepo();
  const fake = fakeModel([
    fauxAssistantMessage("first history ".repeat(2000)),
    fauxAssistantMessage("First summary."),
    fauxAssistantMessage("second history ".repeat(2000)),
    fauxAssistantMessage("Updated summary."),
    fauxAssistantMessage("short reply"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake, store });
  await session.run("first");
  await session.run("second");
  await session.run("third");
  expect(JSON.stringify(fake.contexts[3])).toContain("First summary.");
  expect(JSON.stringify(fake.contexts[3])).toContain("second history");
  const next = fakeModel([fauxAssistantMessage("resumed")]);
  next.model.contextWindow = 4000;
  const resumed = await createSession({ ...dirs, ...next, store, resumeId: session.id });
  await resumed.run("fourth");
  expect(JSON.stringify(next.contexts[0])).toContain("Updated summary.");
  expect(JSON.stringify(next.contexts[0])).not.toContain("First summary.");
  expect(JSON.stringify(next.contexts[0])).not.toContain("first history first history");
});

test.each(["oversized batch", "split prefix"])(
  "repeated compaction within an ongoing Run preserves the previous goal: %s",
  async (shape) => {
    dirs = await tempDirs();
    const split = shape === "split prefix";
    const paths = split ? ["a.txt", "b.txt", "c.txt"] : ["a.txt", "b.txt", "c.txt", "d.txt"];
    for (const path of paths)
      await Bun.write(join(dirs.cwd, path), "x".repeat(split ? 10_000 : 4000));
    if (split) await Bun.write(join(dirs.cwd, "last.txt"), "y".repeat(6000));
    const fake = fakeModel([
      fauxAssistantMessage("old work ".repeat(7000)),
      fauxAssistantMessage("CRITICAL PREVIOUS GOAL: preserve the public interface."),
      fauxAssistantMessage(
        paths.map((path, index) => fauxToolCall("read", { path }, { id: `read-${index}` })),
        { stopReason: "toolUse" },
      ),
      ...(split
        ? [
            fauxAssistantMessage(fauxToolCall("read", { path: "last.txt" }, { id: "read-last" }), {
              stopReason: "toolUse",
            }),
          ]
        : []),
      fauxAssistantMessage(
        "Updated summary: preserve the public interface and finish the file work.",
      ),
      fauxAssistantMessage("finished"),
    ]);
    fake.model.contextWindow = split ? 12_000 : 4000;
    const session = await createSession({ ...dirs, ...fake });
    await session.run("first");
    const events: SessionEvent[] = [];
    expect(
      (
        await session.run("read the files", {
          onEvent: (event) => {
            events.push(event);
          },
        })
      ).text,
    ).toBe("finished");
    expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(2);
    const updatedRequest = fake.contexts.at(-2)!;
    expect(JSON.stringify(updatedRequest)).toContain("CRITICAL PREVIOUS GOAL");
    expect(JSON.stringify(fake.contexts.at(-1))).toContain("Updated summary");
    expect(JSON.stringify(fake.contexts.at(-1))).not.toContain("x".repeat(4000));
    const next = fakeModel([fauxAssistantMessage("resumed")]);
    next.model.contextWindow = fake.model.contextWindow;
    const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
    await resumed.run("continue");
    expect(next.contexts[0]!.messages.slice(0, -2)).toEqual(fake.contexts.at(-1)!.messages);
  },
);

test("failed summarization preserves the Transcript for a later resume", async () => {
  dirs = await tempDirs();
  const original = "recoverable history ".repeat(2000);
  const fake = fakeModel([
    fauxAssistantMessage(original),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "summary unavailable" }),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  await session.run("first");
  const events: SessionEvent[] = [];
  await expect(
    session.run("second", {
      onEvent: (event) => {
        events.push(event);
      },
    }),
  ).rejects.toThrow("summary unavailable");
  expect(events.filter((event) => event.type === "compaction_start")).toEqual([
    { type: "compaction_start", sessionId: session.id, tokensBefore: expect.any(Number) },
  ]);
  expect(events.filter((event) => event.type === "compaction_end")).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: "result", success: false });
  expect(await transcript()).not.toContain('"type":"compaction"');
  const next = fakeModel([
    fauxAssistantMessage("Recovered summary."),
    fauxAssistantMessage("recovered"),
  ]);
  next.model.contextWindow = 4000;
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  await resumed.run("recover");
  expect(JSON.stringify(next.contexts[0])).toContain(original);
});

test("an oversized tail keeps the pending user prompt together with its Skill Invocation", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, ".neant/skills/plan/SKILL.md"),
    "---\nname: plan\ndescription: Plan the work.\n---\nKeep the plan concise.",
  );
  const fake = fakeModel([
    fauxAssistantMessage("old history ".repeat(2500)),
    fauxAssistantMessage("Old work summary."),
    fauxAssistantMessage("planned"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  await session.run("first");
  await session.run("/plan the next task");
  expect(fake.contexts.at(-1)!.messages.slice(-2)).toMatchObject([
    { role: "user", content: [{ type: "text", text: "/plan the next task" }] },
    {
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("Keep the plan concise.") }],
    },
  ]);
});

test("compaction preserves effective MCP tool declarations and resume replays that exact context", async () => {
  dirs = await tempDirs();
  const manifest = join(dirs.homeDir, "manifest.json");
  await Bun.write(manifest, JSON.stringify({ tools: ["old"] }));
  await Bun.write(
    join(dirs.homeDir, ".neant/mcp.json"),
    JSON.stringify({
      mcpServers: {
        local: {
          command: process.execPath,
          args: [fileURLToPath(new URL("../helpers/mcp-server.ts", import.meta.url))],
          env: {
            MCP_MANIFEST: manifest,
            MCP_PIDS: join(dirs.homeDir, "pids"),
            MCP_CALLS: join(dirs.homeDir, "calls"),
          },
        },
      },
    }),
  );
  const fake = fakeModel([
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage("MCP work summary."),
    fauxAssistantMessage("done"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  await session.run("first");
  await Bun.write(manifest, JSON.stringify({ tools: ["current"] }));
  await session.run("second");
  const toolNames = getCurrentTools(fake.contexts.at(-1)!.messages).map((tool) => tool.name);
  expect(toolNames).toContain("mcp__local__current");
  expect(toolNames).not.toContain("mcp__local__old");
  const next = fakeModel([fauxAssistantMessage("resumed")]);
  next.model.contextWindow = 4000;
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  await resumed.run("continue");
  expect(next.contexts[0]!.messages.slice(0, -2)).toEqual(fake.contexts.at(-1)!.messages);
  expect(getCurrentTools(next.contexts[0]!.messages).map((tool) => tool.name)).toEqual(toolNames);
});

test("aborting summary generation cancels its provider request without persisting a compaction", async () => {
  dirs = await tempDirs();
  const original = "history before cancellation ".repeat(2000);
  const fake = fakeModel([fauxAssistantMessage(original)]);
  const summary = abortingModel();
  const streamFn = fake.streamFn;
  fake.streamFn = (model, context, options) =>
    context.messages.some(
      (message) =>
        message.role === "system" &&
        JSON.stringify(message).includes("context summarization assistant"),
    )
      ? summary.streamFn(model, context, options)
      : streamFn(model, context, options);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  await session.run("first");
  const controller = new AbortController();
  const events: SessionEvent[] = [];
  const run = session.run("second", {
    signal: controller.signal,
    onEvent: (event) => {
      events.push(event);
    },
  });
  void run.catch(() => {});
  await summary.started;
  expect(events.at(-1)).toMatchObject({ type: "compaction_start" });
  controller.abort(new Error("cancel summary"));
  await expect(run).rejects.toThrow("cancel summary");
  expect(events.at(-1)).toMatchObject({ type: "result", success: false });
  expect(events.filter((event) => event.type === "compaction_start")).toEqual([
    { type: "compaction_start", sessionId: session.id, tokensBefore: expect.any(Number) },
  ]);
  expect(events.filter((event) => event.type === "compaction_end")).toEqual([]);
  expect(await transcript()).not.toContain('"type":"compaction"');
  const next = fakeModel([
    fauxAssistantMessage("Recovered summary."),
    fauxAssistantMessage("recovered"),
  ]);
  next.model.contextWindow = 4000;
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  expect((await resumed.run("recover")).text).toBe("recovered");
  expect(JSON.stringify(next.contexts[0])).toContain(original);
});

async function transcript() {
  const root = join(dirs.homeDir, ".neant/sessions");
  const files = (await readdir(root, { recursive: true })).filter((file) =>
    file.endsWith(".jsonl"),
  );
  expect(files).toHaveLength(1);
  return Bun.file(join(root, files[0]!)).text();
}
