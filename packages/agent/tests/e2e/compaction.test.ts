import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentTools,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import {
  createJsonlStore,
  createSession as createSessionImpl,
  type Session,
  type SessionEvent,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { abortingModel } from "../helpers/aborting-model.ts";
import { modelStream, withModelStream, withModelAlias } from "../helpers/auxiliary-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
async function createSession(options: Parameters<typeof createSessionImpl>[0]) {
  const session = await createSessionImpl(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});
function publishedReminders(events: readonly SessionEvent[]) {
  return events.flatMap((event) =>
    event.type === "message_end"
      ? event.messages.flatMap((message) =>
          message.role === "system-reminder"
            ? [{ source: message.source, content: message.content }]
            : [],
        )
      : [],
  );
}
function readOld() {
  return fauxAssistantMessage(fauxToolCall("read", { path: "old.txt" }), { stopReason: "toolUse" });
}
function historyModel(replies: FauxResponseStep[]) {
  const fake = fakeModel([
    readOld(),
    fauxAssistantMessage("older evidence recorded"),
    readOld(),
    fauxAssistantMessage("second evidence recorded"),
    fauxAssistantMessage("recent protected reply"),
    ...replies,
  ]);
  const models = withModelAlias(fake.models, "compact-window", ["large"], {
    contextWindow: 128000,
  });
  const provider = models.getProviders().find((provider) => provider.id === "compact-window");
  const large = provider?.getModels()[0];
  if (!provider || !large) throw new Error("Missing fixture provider.");
  models.setProvider({
    ...provider,
    getModels: () => [large, { ...large, id: "small", contextWindow: 16000 }],
  });
  return { ...fake, models, settings: { model: "compact-window/large" } };
}
/** Real old tool evidence gives the locked native compactor an eligible prefix and a protected recent Run. */
async function seedHistory(session: Session) {
  await Bun.write(join(dirs.cwd, "old.txt"), "OLD_EVIDENCE widget contract ".repeat(2000));
  await session.run("inspect old widgets");
  await session.run("inspect second evidence");
  await session.run("recent retained task");
}
async function nativeJournal() {
  const root = join(dirs.homeDir, ".rukie/durable-sessions");
  const paths = (await readdir(root, { recursive: true })).filter((path) =>
    path.endsWith("/main.jsonl"),
  );
  expect(paths).toHaveLength(1);
  return Bun.file(join(root, paths[0]!)).text();
}
function committedCompactions(journal: string) {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;
  return journal
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const commit: unknown = JSON.parse(line);
      if (!isRecord(commit) || !Array.isArray(commit.writes)) return [];
      return commit.writes.filter(
        (write: unknown) =>
          isRecord(write) &&
          write.type === "entry" &&
          isRecord(write.value) &&
          write.value.kind === "pi.compaction",
      );
    });
}

test("manual Compaction summarizes eligible history, keeps focus outside model Transcript and resumes the committed context", async () => {
  dirs = await tempDirs();
  const fake = historyModel([
    fauxAssistantMessage("Focused widget summary."),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await seedHistory(session);
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  await session.compact({ instructions: "FOCUS_KEEP_WIDGET_CONTRACT" });
  expect(JSON.stringify(fake.contexts[5])).toContain("FOCUS_KEEP_WIDGET_CONTRACT");
  expect(JSON.stringify(fake.contexts[5])).toContain("OLD_EVIDENCE");
  expect(JSON.stringify(session.messages)).not.toContain("FOCUS_KEEP_WIDGET_CONTRACT");
  expect(events.filter((event) => event.type.startsWith("compaction_"))).toMatchObject([
    { type: "compaction_start", reason: "manual" },
    { type: "compaction_end", reason: "manual" },
  ]);
  expect(session.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "session-notice",
        notice: { kind: "compaction", reason: "manual" },
      }),
    ]),
  );
  await session.run("continue");
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("Focused widget summary.");
  const messages = structuredClone(session.messages);
  await session.close();
  const untouched = fakeModel([]);
  const restored = await createSession({ ...dirs, ...untouched, resumeId: session.id });
  expect(restored.messages).toEqual(messages);
  expect(untouched.contexts).toHaveLength(0);
});

test("manual Compaction rejects an active Run; empty and tiny history do not request a summary", async () => {
  dirs = await tempDirs();
  const fake = abortingModel();
  const session = await createSession({ ...dirs, ...fake });
  await session.compact();
  const run = session.run("pending work");
  await fake.started;
  const before = structuredClone(session.messages);
  await expect(session.compact()).rejects.toThrow("idle");
  expect(session.messages).toEqual(before);
  await session.abort();
  await expect(run).rejects.toThrow();
  await session.close();
  const tiny = fakeModel([fauxAssistantMessage("short answer")]);
  const small = await createSession({ ...dirs, ...tiny });
  await small.run("tiny history");
  const messages = structuredClone(small.messages);
  await small.compact();
  expect(tiny.contexts).toHaveLength(1);
  expect(small.messages).toEqual(messages);
});

test.each(["abort", "close"] as const)(
  "%s cancels an eligible manual summary and releases its native operation",
  async (action) => {
    dirs = await tempDirs();
    const fake = historyModel([]);
    const summary = abortingModel();
    const primary = modelStream(fake.models);
    fake.models = withModelStream(fake.models, (model, context, options) =>
      JSON.stringify(context.messages).includes("context summarization assistant")
        ? modelStream(summary.models)(summary.model, context, options)
        : primary(model, context, options),
    );
    const session = await createSession({ ...dirs, ...fake });
    await seedHistory(session);
    const before = structuredClone(session.messages);
    const compact = session.compact();
    const rejected = compact.catch((error: unknown) => error);
    await summary.started;
    await expect(session.run("competing prompt")).rejects.toThrow();
    await expect(session.compact()).rejects.toThrow();
    await expect(session.setModel("missing/model")).rejects.toThrow();
    if (action === "abort") await session.abort();
    else await session.close();
    expect(await rejected).toBeInstanceOf(Error);
    expect(session.messages).toEqual(before);
    expect(committedCompactions(await nativeJournal())).toEqual([]);
    await session.close();
    const replies = fakeModel([fauxAssistantMessage("recovered summary")]);
    const restored = await createSession({ ...dirs, ...replies, resumeId: session.id });
    await restored.waitForIdle();
    if (action === "abort") {
      expect(replies.contexts).toHaveLength(0);
      expect(restored.messages).toEqual(before);
    } else {
      expect(replies.contexts).toHaveLength(1);
      expect(restored.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "session-notice",
            notice: { kind: "compaction", reason: "manual" },
          }),
        ]),
      );
    }
  },
);

test("manual Compaction after cold reopen refreshes current project, skill, Plan Mode and frontend guidance", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Original project contract.");
  const original = await createSession({ ...dirs, ...historyModel([]) });
  await seedHistory(original);
  await original.setPlanMode(true);
  await original.close();
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Updated project contract.");
  await Bun.write(
    join(dirs.cwd, ".agents/skills/new-skill/SKILL.md"),
    "---\nname: new-skill\ndescription: New review skill\n---\nReview widgets.",
  );
  const fake = fakeModel([
    fauxAssistantMessage("Refreshed summary."),
    fauxAssistantMessage("continued"),
    fauxAssistantMessage("changed"),
  ]);
  let frontend = "Current frontend state.";
  const session = await createSession({
    ...dirs,
    ...fake,
    resumeId: original.id,
    reminderSources: [{ source: "frontend", currentContent: () => frontend }],
  });
  await session.compact();
  const messages = JSON.stringify(session.messages);
  for (const text of [
    "Updated project contract.",
    "New review skill",
    "Current frontend state.",
    "plan-mode",
  ])
    expect(messages).toContain(text);
  expect(messages).not.toContain("git branch:");
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  await session.run("continue");
  expect(publishedReminders(events)).toEqual([]);
  frontend = "Updated frontend state.";
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Latest project contract.");
  events.length = 0;
  await session.run("changed");
  expect(publishedReminders(events).map((message) => message.source)).toEqual([
    "project-instructions",
    "frontend",
  ]);
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("Latest project contract.");
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("Updated frontend state.");
});

test("native Compaction is appended without deleting historical evidence and cold reopen preserves the current suffix", async () => {
  dirs = await tempDirs();
  const fake = historyModel([
    fauxAssistantMessage("Saved summary."),
    fauxAssistantMessage("after summary"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await seedHistory(session);
  const before = await nativeJournal();
  await session.compact();
  await session.run("next prompt");
  const after = await nativeJournal();
  expect(after).toStartWith(before);
  expect(after).toContain("OLD_EVIDENCE widget contract OLD_EVIDENCE");
  expect(committedCompactions(after)).toHaveLength(1);
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("Saved summary.");
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("recent retained task");
  const messages = structuredClone(session.messages);
  await session.close();
  const next = fakeModel([fauxAssistantMessage("resumed")]);
  const restored = await createSession({ ...dirs, ...next, resumeId: session.id });
  expect(restored.messages).toEqual(messages);
  await restored.run("resume prompt");
  const request = JSON.stringify(next.contexts[0]);
  for (const text of ["Saved summary.", "after summary", "resume prompt"])
    expect(request).toContain(text);
});

test("a summarizer failure reports failure without placing a Compaction and a later cold retry preserves its source", async () => {
  dirs = await tempDirs();
  const fake = historyModel([
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "summary unavailable" }),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await seedHistory(session);
  const before = structuredClone(session.messages);
  await expect(session.compact()).rejects.toThrow("summary unavailable");
  expect(session.messages).toEqual(before);
  expect(committedCompactions(await nativeJournal())).toEqual([]);
  await session.close();
  const next = fakeModel([
    fauxAssistantMessage("Recovered summary."),
    fauxAssistantMessage("recovered"),
  ]);
  const restored = await createSession({ ...dirs, ...next, resumeId: session.id });
  await restored.compact();
  expect(JSON.stringify(next.contexts[0])).toContain("OLD_EVIDENCE");
  await restored.run("recover");
  expect(JSON.stringify(next.contexts.at(-1))).toContain("Recovered summary.");
});

test("an injected native Session Store preserves the previous summary through a second Compaction and reopen", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const fake = historyModel([
    fauxAssistantMessage("CRITICAL PREVIOUS GOAL: preserve the public interface."),
    readOld(),
    fauxAssistantMessage("new evidence recorded"),
    readOld(),
    fauxAssistantMessage("second new evidence recorded"),
    fauxAssistantMessage("recent task complete"),
    fauxAssistantMessage("Updated summary preserves the public interface."),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({ ...dirs, ...fake, store });
  await seedHistory(session);
  await session.compact();
  await session.run("more evidence");
  await session.run("second more evidence");
  await session.run("recent next task");
  await session.compact();
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("CRITICAL PREVIOUS GOAL");
  await session.run("continue");
  expect(JSON.stringify(fake.contexts.at(-1))).toContain(
    "Updated summary preserves the public interface.",
  );
  await session.close();
  const next = fakeModel([fauxAssistantMessage("resumed")]);
  const restored = await createSession({ ...dirs, ...next, store, resumeId: session.id });
  await restored.run("reopen");
  expect(JSON.stringify(next.contexts[0])).toContain(
    "Updated summary preserves the public interface.",
  );
});

test.each(["normal prompt", "oversized Skill Invocation"] as const)(
  "a native threshold Compaction preserves the admitted %s and current guidance",
  async (shape) => {
    dirs = await tempDirs();
    await Bun.write(join(dirs.cwd, "AGENTS.md"), "Preserve the widget contract.");
    await Bun.write(
      join(dirs.cwd, ".agents/skills/plan/SKILL.md"),
      "---\nname: plan\ndescription: Plan the work\n---\nKeep the plan concise.",
    );
    const fake = historyModel([
      fauxAssistantMessage("Summary of old work."),
      fauxAssistantMessage("continued"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      now: () => new Date("2026-10-01T12:00:00Z"),
      reminderSources: [{ source: "frontend", currentContent: () => "Describe active work." }],
    });
    const events: SessionEvent[] = [];
    session.subscribe((event) => events.push(event));
    await seedHistory(session);
    expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(0);
    await session.setModel("compact-window/small");
    events.length = 0;
    const prompt =
      shape === "normal prompt"
        ? "continue the task"
        : "/plan pending task " + "TAIL_KEEP ".repeat(3000);
    expect(await session.run(prompt)).toMatchObject({ text: "continued" });
    expect(events.filter((event) => event.type === "compaction_start")).toMatchObject([
      { reason: "threshold" },
    ]);
    expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
    const request = JSON.stringify(fake.contexts.at(-1));
    for (const text of [
      "Summary of old work.",
      "Preserve the widget contract.",
      "Current date: 2026-10-01",
      "Describe active work.",
      prompt,
    ])
      expect(request).toContain(text);
    if (shape === "oversized Skill Invocation") expect(request).toContain("Keep the plan concise.");
    const calls = fake.contexts
      .at(-1)!
      .messages.flatMap((message) =>
        message.role === "assistant"
          ? message.content.filter((part) => part.type === "toolCall").map((part) => part.id)
          : [],
      );
    for (const message of fake.contexts.at(-1)!.messages)
      if (message.role === "toolResult") expect(calls).toContain(message.toolCallId);
  },
);

test("native Compaction preserves current MCP declarations and instructions across cold reopen", async () => {
  dirs = await tempDirs();
  const manifest = join(dirs.homeDir, "manifest.json");
  await Bun.write(
    manifest,
    JSON.stringify({ tools: ["old"], instructions: "Inspect widgets through this MCP server." }),
  );
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
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
  const original = await createSession({ ...dirs, ...historyModel([]) });
  await seedHistory(original);
  await original.close();
  const fake = fakeModel([fauxAssistantMessage("MCP work summary."), fauxAssistantMessage("done")]);
  const models = withModelAlias(fake.models, "compact-window", ["large"], {
    contextWindow: 128000,
  });
  await Bun.write(
    manifest,
    JSON.stringify({
      tools: ["current"],
      instructions: "Inspect widgets through this MCP server.",
    }),
  );
  const session = await createSession({ ...dirs, ...fake, models, resumeId: original.id });
  await session.compact();
  await session.run("continue");
  const request = fake.contexts.at(-1)!.messages;
  expect(JSON.stringify(request)).toContain("Inspect widgets through this MCP server.");
  const tools = getCurrentTools(request).map((tool) => tool.name);
  expect(tools).toContain("mcp__local__current");
  expect(tools).not.toContain("mcp__local__old");
  const messages = structuredClone(session.messages);
  await session.close();
  const next = fakeModel([fauxAssistantMessage("resumed")]);
  const restored = await createSession({
    ...dirs,
    ...next,
    models: withModelAlias(next.models, "compact-window", ["large"], { contextWindow: 128000 }),
    resumeId: session.id,
  });
  expect(restored.messages).toEqual(messages);
  await restored.run("cold continue");
  expect(getCurrentTools(next.contexts[0]!.messages).map((tool) => tool.name)).toEqual(tools);
  expect(JSON.stringify(next.contexts[0])).toContain("Inspect widgets through this MCP server.");
});

test("aborting native threshold Compaction preserves its admitted prompt without committing a partial summary", async () => {
  dirs = await tempDirs();
  const fake = historyModel([]);
  const summary = abortingModel();
  const primary = modelStream(fake.models);
  fake.models = withModelStream(fake.models, (model, context, options) =>
    JSON.stringify(context.messages).includes("context summarization assistant")
      ? modelStream(summary.models)(summary.model, context, options)
      : primary(model, context, options),
  );
  const session = await createSession({ ...dirs, ...fake });
  await seedHistory(session);
  await session.setModel("compact-window/small");
  const pending = session.run("PRESERVE_ABORTED_THRESHOLD_PROMPT");
  const rejected = pending.catch((error: unknown) => error);
  await summary.started;
  await session.abort();
  expect(await rejected).toBeInstanceOf(Error);
  expect(committedCompactions(await nativeJournal())).toEqual([]);
  expect(JSON.stringify(session.messages)).toContain("PRESERVE_ABORTED_THRESHOLD_PROMPT");
  await session.close();
  const next = fakeModel([
    fauxAssistantMessage("Successful retry summary."),
    fauxAssistantMessage("continued"),
  ]);
  const models = withModelAlias(next.models, "compact-window", ["small"], { contextWindow: 16000 });
  const restored = await createSession({ ...dirs, ...next, models, resumeId: session.id });
  await restored.waitForIdle();
  expect(next.contexts).toHaveLength(0);
  await restored.run("explicit retry");
  expect(JSON.stringify(next.contexts[0])).toContain("OLD_EVIDENCE");
  expect(JSON.stringify(next.contexts.at(-1))).toContain("Successful retry summary.");
  expect(JSON.stringify(next.contexts.at(-1))).toContain("explicit retry");
});
