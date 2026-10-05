import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
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

test("manual compaction summarizes small idle conversations and keeps focus out of the transcript", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("Widget behavior to preserve."),
    fauxAssistantMessage("Focused widget summary."),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("inspect widgets");
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  await session.compact({ instructions: "FOCUS_KEEP_WIDGET_CONTRACT" });
  expect(JSON.stringify(fake.contexts[1])).toContain("FOCUS_KEEP_WIDGET_CONTRACT");
  expect(JSON.stringify(session.messages)).toContain("Focused widget summary.");
  expect(await transcript()).not.toContain("FOCUS_KEEP_WIDGET_CONTRACT");
  expect(events.filter((event) => event.type.startsWith("compaction_"))).toMatchObject([
    { type: "compaction_start", trigger: "manual" },
    { type: "compaction_end", trigger: "manual" },
  ]);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
  await session.run("continue");
  expect(JSON.stringify(fake.contexts[2])).toContain("Focused widget summary.");
});

test("manual compaction rejects empty history and an active Run without changing messages", async () => {
  dirs = await tempDirs();
  const fake = abortingModel();
  const session = await createSession({ ...dirs, ...fake });
  await expect(session.compact()).rejects.toThrow("no compactable conversation history");
  const run = session.run("pending work");
  await fake.started;
  const before = structuredClone(session.messages);
  await expect(session.compact()).rejects.toThrow("active Run");
  expect(session.messages).toEqual(before);
  session.interruptRun();
  await expect(run).rejects.toThrow();
});

test("manual compaction owns its idle operation and interruption leaves history resumable", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("original conversation")]);
  const summary = abortingModel();
  const primary = fake.streamFn;
  fake.streamFn = (model, context, options) =>
    context.messages.some(
      (message) =>
        message.role === "system" &&
        JSON.stringify(message).includes("context summarization assistant"),
    )
      ? summary.streamFn(model, context, options)
      : primary(model, context, options);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("work");
  const before = structuredClone(session.messages);
  const compact = session.compact();
  void compact.catch(() => {});
  await summary.started;
  await expect(session.run("competing prompt")).rejects.toThrow("compacting");
  await expect(session.compact()).rejects.toThrow("compacting");
  await expect(session.setModel("missing/model")).rejects.toThrow("idle");
  await expect(session.setPlanMode(true)).rejects.toThrow("compacting");
  session.interruptRun();
  await expect(compact).rejects.toThrow();
  expect(session.messages).toEqual(before);
  expect(await transcript()).not.toContain('"type":"compaction"');
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(before);
});

test("disposing during manual summary cancels it before the session finishes disposing", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("original conversation")]);
  const summary = abortingModel();
  const primary = fake.streamFn;
  fake.streamFn = (model, context, options) =>
    context.messages.some(
      (message) =>
        message.role === "system" &&
        JSON.stringify(message).includes("context summarization assistant"),
    )
      ? summary.streamFn(model, context, options)
      : primary(model, context, options);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("work");
  let settled = false;
  const compact = session.compact().finally(() => {
    settled = true;
  });
  void compact.catch(() => {});
  await summary.started;
  await session.dispose();
  expect(settled).toBe(true);
  await expect(compact).rejects.toThrow();
  expect(await transcript()).not.toContain('"type":"compaction"');
});

test("manual compaction immediately after resume refreshes project, skill, plan and frontend reminders", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Original project contract.");
  const original = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("old work")]),
  });
  await original.run("first");
  await original.setPlanMode(true);
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Updated project contract.");
  await Bun.write(
    join(dirs.cwd, ".agents/skills/new-skill/SKILL.md"),
    "---\nname: new-skill\ndescription: New review skill\n---\nReview widgets.\n",
  );
  const fake = fakeModel([
    fauxAssistantMessage("Refreshed summary."),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    resumeId: original.id,
    reminderSources: [{ source: "frontend", currentContent: () => "Current frontend state." }],
  });
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  await session.compact();
  const context = JSON.stringify(session.messages);
  expect(context).toContain("Updated project contract.");
  expect(context).toContain("New review skill");
  expect(context).toContain("Current frontend state.");
  expect(
    session.messages.some(
      (message) => message.role === "system-reminder" && message.source === "plan-mode",
    ),
  ).toBe(true);
  expect(context).not.toContain("git branch:");
  await expect(session.compact()).rejects.toThrow("no compactable conversation history");
  events.length = 0;
  await session.run("continue");
  expect(events.filter((event) => event.type === "reminder_injected")).toHaveLength(0);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
});

test("Compaction restores current Project Instructions, skills and frontend reminders before the retained request", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.homeDir, ".neant/AGENTS.md"), "Use personal conventions.");
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Preserve the widget contract.");
  await Bun.write(
    join(dirs.cwd, ".agents/skills/review/SKILL.md"),
    "---\nname: review\ndescription: Review widget changes\n---\nInspect the diff.\n",
  );
  const fake = fakeModel([
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage("Summary of old work."),
    fauxAssistantMessage("continued"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({
    ...dirs,
    ...fake,
    now: () => new Date("2026-10-01T12:00:00Z"),
    reminderSources: [{ source: "frontend", currentContent: () => "Describe active work." }],
  });
  await session.run("start");
  const events: SessionEvent[] = [];
  let compactedMessages: (typeof session.messages)[number][] = [];
  await session.run("continue", {
    onEvent: (event) => {
      events.push(event);
      if (event.type === "compaction_end")
        compactedMessages = structuredClone([...session.messages]);
    },
  });

  const request = JSON.stringify(fake.contexts[2]!.messages);
  expect(request).toContain("Preserve the widget contract.");
  expect(request).toContain("Use personal conventions.");
  expect(request).toContain("Review widget changes");
  expect(request).toContain("Current date: 2026-10-01");
  expect(request).toContain("Describe active work.");
  expect(request).not.toContain("git branch:");
  expect(
    events.filter((event) => event.type === "reminder_injected").map((event) => event.source),
  ).toEqual(["date", "user-instructions", "project-instructions", "skills", "frontend"]);
  expect(session.messages.slice(2, -2)).toMatchObject([
    { role: "system-reminder", source: "date" },
    { role: "system-reminder", source: "user-instructions" },
    { role: "system-reminder", source: "project-instructions" },
    { role: "system-reminder", source: "skills" },
    { role: "system-reminder", source: "frontend" },
  ]);
  expect(session.messages.at(-2)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "continue" }],
  });
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
  expect(resumed.messages.slice(0, -1)).toEqual(compactedMessages);
});

test("the Run after Compaction skips unchanged reminders and sends changed current content", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Original project conventions.");
  let frontend = "Describe active work.";
  let date = new Date("2026-10-01T12:00:00Z");
  const fake = fakeModel([
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage("Summary of old work."),
    fauxAssistantMessage("continued"),
    fauxAssistantMessage("unchanged"),
    fauxAssistantMessage("updated"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({
    ...dirs,
    ...fake,
    now: () => date,
    reminderSources: [{ source: "frontend", currentContent: () => frontend }],
  });
  await session.run("start");
  await session.run("compact");
  const next = fakeModel([]);
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
  expect(resumed.messages.slice(2, -2)).toMatchObject([
    { role: "system-reminder", source: "date" },
    { role: "system-reminder", source: "project-instructions" },
    { role: "system-reminder", source: "skills" },
    { role: "system-reminder", source: "frontend" },
  ]);

  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("unchanged", { onEvent });
  expect(events.filter((event) => event.type === "reminder_injected")).toEqual([]);

  frontend = "Describe completed work.";
  date = new Date("2026-10-02T12:00:00Z");
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Updated project conventions.");
  await Bun.write(
    join(dirs.cwd, ".agents/skills/review/SKILL.md"),
    "---\nname: review\ndescription: Review widget changes\n---\nInspect the diff.\n",
  );
  events.length = 0;
  await session.run("changed", { onEvent });
  expect(
    events.filter((event) => event.type === "reminder_injected").map((event) => event.source),
  ).toEqual(["date", "project-instructions", "skills", "frontend"]);
  const request = JSON.stringify(fake.contexts.at(-1)!.messages);
  expect(request).toContain("Current date: 2026-10-02");
  expect(request).toContain("Updated project conventions.");
  expect(request).toContain("Review widget changes");
  expect(request).toContain("Describe completed work.");
});

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
    {
      type: "compaction_start",
      trigger: "auto",
      sessionId: session.id,
      tokensBefore: expect.any(Number),
    },
    {
      type: "compaction_end",
      trigger: "auto",
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
      ...(split ? [fauxAssistantMessage("Split-turn summary: finish the file work.")] : []),
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
    const updatedRequest = fake.contexts[split ? 4 : 3]!;
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
    {
      type: "compaction_start",
      trigger: "auto",
      sessionId: session.id,
      tokensBefore: expect.any(Number),
    },
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
  await Bun.write(
    manifest,
    JSON.stringify({ tools: ["old"], instructions: "Inspect widgets through this MCP server." }),
  );
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
  await Bun.write(
    manifest,
    JSON.stringify({
      tools: ["current"],
      instructions: "Inspect widgets through this MCP server.",
    }),
  );
  const events: SessionEvent[] = [];
  await session.run("second", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(
    events.filter((event) => event.type === "reminder_injected" && event.source === "mcp"),
  ).toHaveLength(2);
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).toContain(
    "Inspect widgets through this MCP server.",
  );
  const toolNames = getCurrentTools(fake.contexts.at(-1)!.messages).map((tool) => tool.name);
  expect(toolNames).toContain("mcp__local__current");
  expect(toolNames).not.toContain("mcp__local__old");
  const next = fakeModel([fauxAssistantMessage("resumed")]);
  next.model.contextWindow = 4000;
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
  const resumedEvents: SessionEvent[] = [];
  await resumed.run("continue", {
    onEvent: (event) => {
      resumedEvents.push(event);
    },
  });
  expect(resumedEvents.filter((event) => event.type === "reminder_injected")).toEqual([]);
  expect(next.contexts[0]!.messages.slice(0, -2)).toEqual(fake.contexts.at(-1)!.messages);
  expect(getCurrentTools(next.contexts[0]!.messages).map((tool) => tool.name)).toEqual(toolNames);
});

test("aborting summary generation cancels its provider request without persisting a compaction", async () => {
  dirs = await tempDirs();
  const original = "history before cancellation ".repeat(2000);
  const fake = fakeModel([fauxAssistantMessage(original)]);
  const summary = abortingModel();
  const streamFn = fake.streamFn;
  fake.streamFn = withAuxiliaryRequests((model, context, options) =>
    context.messages.some(
      (message) =>
        message.role === "system" &&
        JSON.stringify(message).includes("context summarization assistant"),
    )
      ? summary.streamFn(model, context, options)
      : streamFn(model, context, options),
  );
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
    {
      type: "compaction_start",
      trigger: "auto",
      sessionId: session.id,
      tokensBefore: expect.any(Number),
    },
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
