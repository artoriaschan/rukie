import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import {
  getCurrentSystemPrompt,
  getCurrentSystemMessage,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createSession,
  type SessionEvent,
  type Session,
  type TranscriptMessage,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
async function openSession(options: Parameters<typeof createSession>[0]) {
  const session = await createSession(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});
/** Newly committed reminder entries, rather than a second notification protocol. */
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

function identity(messages: readonly TranscriptMessage[]): string {
  const system = messages.find(
    (message) => message.role === "system" && message.sections?.instructions,
  );
  if (!system || system.role !== "system" || !system.sections?.instructions)
    throw new Error("Missing native system instructions.");
  return system.sections.instructions;
}

test("the first Run supplies static identity, environment and both levels of Project Instructions", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.homeDir, ".rukie/AGENTS.md"), "Personal coding preferences");
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Project coding conventions");
  await Bun.write(join(dirs.cwd, "CLAUDE.md"), "Ignored fallback instructions");
  expect(await Bun.spawn(["git", "init", "-b", "reminder-test"], { cwd: dirs.cwd }).exited).toBe(0);
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const events: SessionEvent[] = [];
  const session = await openSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    ...fake,
    now: () => new Date("2026-10-01T12:00:00Z"),
  });
  const result = await session.run("original prompt", {
    onEvent: (event) => {
      events.push(structuredClone(event));
    },
  });
  const messages = fake.contexts[0]!.messages;
  expect(identity(messages)).toContain("Rukie");
  const reminders = publishedReminders(events);
  expect(reminders.map((event) => event.source)).toEqual([
    "environment",
    "time",
    "user-instructions",
    "project-instructions",
  ]);
  expect(getCurrentSystemPrompt(messages)).toContain(`cwd: ${dirs.cwd}`);
  expect(reminders[0]!.content).not.toContain("cwd:");
  expect(getCurrentSystemPrompt(messages)).toContain(`platform: ${process.platform}`);
  expect(reminders[0]!.content).toContain("git branch: reminder-test");
  expect(reminders[0]!.content).toContain("?? AGENTS.md");
  expect(reminders[1]!.content).toContain("Current time: 2026-10-01");
  expect(reminders[2]!.content).toStartWith("User Instructions (");
  expect(reminders[2]!.content).toContain("Personal coding preferences");
  expect(reminders[3]!.content).toContain("Project coding conventions");
  expect(JSON.stringify(messages)).not.toContain("Ignored fallback instructions");
  expect(messages.filter((message) => message.role === "user").slice(0, -1)).toEqual(
    reminders.map((event) => ({
      role: "user",
      content: [{ type: "text", text: `<system-reminder>\n${event.content}\n</system-reminder>` }],
      timestamp: expect.any(Number),
    })),
  );
  expect(messages.findLast((message) => message.role === "user")).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "original prompt" }],
  });
  expect(events[0]!.type).toBe("snapshot");
  expect(events.at(-1)!.type).toBe("result");
  expect(events.every((event) => event.sessionId === session.id)).toBe(true);
  expect(result.text).toBe("done");
});

async function transcript() {
  const root = join(dirs.homeDir, ".rukie/durable-sessions");
  const files = await readdir(root, { recursive: true });
  const file = files.find((path) => path.endsWith(".jsonl"))!;
  return Bun.file(join(root, file)).text();
}

test("resume preserves the model and Transcript prefix and appends changed time and Project Instructions", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Original project instructions");
  let date = new Date("2026-10-01T12:00:00Z");
  const clock = () => date;
  const fake = fakeModel([
    fauxAssistantMessage("first reply"),
    fauxAssistantMessage("second reply"),
  ]);
  const session = await openSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    ...fake,
    now: clock,
  });
  await session.run("first prompt");
  const before = await transcript();
  const storedMessages = structuredClone(session.messages);
  expect(storedMessages[0]).toMatchObject({ role: "system-reminder", source: "environment" });
  expect(storedMessages.filter((message) => message.role === "system-reminder")).toMatchObject([
    { source: "environment" },
    { source: "time", content: expect.stringContaining("Current time: 2026-10-01") },
    {
      source: "project-instructions",
      content: expect.stringContaining("Original project instructions"),
    },
  ]);
  const events: SessionEvent[] = [];
  await session.run("second prompt", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(publishedReminders(events)).toEqual([]);
  const prefix = structuredClone(fake.contexts[1]!.messages);
  const beforeResume = await transcript();

  date = new Date("2026-10-02T12:00:00Z");
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "New instructions must not rewrite the prefix");
  await session.close();
  const next = fakeModel([fauxAssistantMessage("continued")]);
  const resumed = await openSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    ...next,
    now: clock,
    resumeId: session.id,
  });
  events.length = 0;
  await resumed.run("continue", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const current = next.contexts[0]!.messages;
  expect(current.slice(0, prefix.length)).toEqual(prefix);
  expect(current.slice(prefix.length)).toMatchObject([
    { role: "assistant", content: [{ type: "text", text: "second reply" }] },
    {
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("Current time: 2026-10-02") }],
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: expect.stringContaining("New instructions must not rewrite the prefix"),
        },
      ],
    },
    { role: "user", content: [{ type: "text", text: "continue" }] },
  ]);
  expect(publishedReminders(events)).toEqual([
    {
      source: "time",
      content: expect.stringContaining("Current time: 2026-10-02"),
    },
    {
      source: "project-instructions",
      content: expect.stringContaining("New instructions must not rewrite the prefix"),
    },
  ]);
  expect(await transcript()).toStartWith(beforeResume);
  expect(beforeResume).toStartWith(before);
});

test.each(["CLAUDE.md", "absent", "empty AGENTS.md"])(
  "Project Instructions use the fallback only when AGENTS.md is absent: %s",
  async (mode) => {
    dirs = await tempDirs();
    if (mode !== "absent")
      await Bun.write(join(dirs.cwd, "CLAUDE.md"), "Fallback project instructions");
    if (mode === "empty AGENTS.md") await Bun.write(join(dirs.cwd, "AGENTS.md"), "");
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const session = await openSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });
    const events: SessionEvent[] = [];
    await session.run("hi", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const instructions = publishedReminders(events).filter((event) =>
      event.source.endsWith("instructions"),
    );
    if (mode === "absent") expect(instructions).toEqual([]);
    else {
      expect(instructions).toHaveLength(1);
      expect(instructions[0]!.content).toContain(
        mode === "CLAUDE.md" ? "Fallback project instructions" : "AGENTS.md",
      );
    }
    if (mode === "empty AGENTS.md")
      expect(JSON.stringify(fake.contexts)).not.toContain("Fallback project instructions");
    expect(
      publishedReminders(events).find((event) => event.source === "environment"),
    ).toMatchObject({
      content: expect.stringContaining("git branch: unavailable"),
    });
  },
);

test("System Prompt keeps stable sections across dates and changes only environment across projects", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("done")]);
  await (await openSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake })).run("hi");
  const other = fakeModel([fauxAssistantMessage("done")]);
  await Bun.write(join(dirs.homeDir, "AGENTS.md"), "Different project instructions");
  await (
    await openSession({
      cwd: dirs.homeDir,
      homeDir: dirs.homeDir,
      ...other,
      now: () => new Date("2030-01-01T12:00:00Z"),
    })
  ).run("different prompt");
  const first = getCurrentSystemMessage(fake.contexts[0]!.messages)!.sections!;
  const second = getCurrentSystemMessage(other.contexts[0]!.messages)!.sections!;
  const { environment: firstEnvironment, ...firstStable } = first;
  const { environment: secondEnvironment, ...secondStable } = second;
  expect(firstStable).toEqual(secondStable);
  expect(firstEnvironment).toContain(dirs.cwd);
  expect(secondEnvironment).toContain(dirs.homeDir);
  expect(getCurrentSystemPrompt(fake.contexts[0]!.messages)).toContain("Reply in the language");
  const prompt = identity(fake.contexts[0]!.messages);
  expect(prompt).not.toContain(dirs.cwd);
  expect(prompt).not.toContain("2026-10-01");
  expect(prompt).not.toContain("Different project instructions");
});

test("additional sources compare current content against the latest persisted value independently", async () => {
  dirs = await tempDirs();
  const now = () => new Date("2026-10-01T12:00:00Z");
  const fake = fakeModel([fauxAssistantMessage("first reply")]);
  const session = await openSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    ...fake,
    now,
    reminderSources: [
      { source: "catalog", currentContent: () => "Available: alpha" },
      { source: "services", currentContent: () => "Connected: local" },
    ],
  });
  await session.run("first prompt");
  const before = await transcript();
  let catalog = "Available: beta";
  await session.close();
  const next = fakeModel([
    fauxAssistantMessage("second reply"),
    fauxAssistantMessage("third reply"),
    fauxAssistantMessage("fourth reply"),
  ]);
  const resumed = await openSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    ...next,
    now,
    resumeId: session.id,
    reminderSources: [
      { source: "catalog", currentContent: () => catalog },
      { source: "services", currentContent: () => "Connected: local" },
      { source: "new-source", currentContent: () => "New context" },
    ],
  });
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await resumed.run("continue", { onEvent });
  expect(publishedReminders(events).map(({ source, content }) => ({ source, content }))).toEqual([
    { source: "catalog", content: "Available: beta" },
    { source: "new-source", content: "New context" },
  ]);
  expect(next.contexts[0]!.messages.slice(0, fake.contexts[0]!.messages.length)).toEqual(
    fake.contexts[0]!.messages,
  );
  expect(await transcript()).toStartWith(before);
  events.length = 0;
  await resumed.run("unchanged", { onEvent });
  expect(publishedReminders(events)).toEqual([]);
  catalog = "Available: alpha";
  events.length = 0;
  await resumed.run("changed back", { onEvent });
  expect(publishedReminders(events)).toEqual([
    {
      source: "catalog",
      content: "Available: alpha",
    },
  ]);
});

test("additional directories appear once in the environment without changing cwd", async () => {
  dirs = await tempDirs();
  const extra = join(dirs.homeDir, "other-project");
  await Bun.write(join(extra, ".keep"), "");
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const session = await openSession({
    ...dirs,
    ...fake,
    additionalDirectories: [extra, extra, dirs.cwd],
  });
  await session.run("inspect projects");
  expect(getCurrentSystemPrompt(fake.contexts[0]!.messages)).toContain(
    `cwd: ${dirs.cwd}\nadditional directories:\n${extra}\nplatform:`,
  );
});

test("additional Project Instructions compare changes independently and rebuild after Resume", async () => {
  dirs = await tempDirs();
  const extra = join(dirs.homeDir, "other-project");
  const another = join(dirs.homeDir, "third-project");
  await Bun.write(join(extra, "AGENTS.md"), "Additional instructions version one");
  await Bun.write(join(another, "AGENTS.md"), "Independent third-project instructions");
  const fake = fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
  const session = await openSession({ ...dirs, ...fake, additionalDirectories: [extra, another] });
  await session.run("first");
  expect(JSON.stringify(fake.contexts[0]!.messages)).toContain(
    "Additional instructions version one",
  );
  expect(JSON.stringify(fake.contexts[0]!.messages)).toContain(
    "Independent third-project instructions",
  );
  await Bun.write(join(extra, "AGENTS.md"), "Additional instructions version two");
  const events: SessionEvent[] = [];
  await session.run("second", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(publishedReminders(events)).toEqual([
    {
      source: `project-instructions:${extra}`,
      content: `Project Instructions (${join(extra, "AGENTS.md")}):\nAdditional instructions version two`,
    },
  ]);
  const prefix = structuredClone(fake.contexts[1]!.messages);
  await session.close();
  const next = fakeModel([fauxAssistantMessage("third")]);
  const resumed = await openSession({
    ...dirs,
    ...next,
    resumeId: session.id,
    additionalDirectories: [extra, another],
  });
  events.length = 0;
  await resumed.run("third", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(next.contexts[0]!.messages.slice(0, prefix.length)).toEqual(prefix);
  expect(publishedReminders(events)).toEqual([]);
});

test("additional directories supply no configuration, hooks, MCP or skills and tools keep cwd", async () => {
  dirs = await tempDirs();
  const extra = join(dirs.homeDir, "other-project");
  const marker = join(extra, "hook-ran");
  await Bun.write(
    join(extra, ".rukie/settings.json"),
    JSON.stringify({
      model: "missing/model",
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: `touch '${marker}'` }] }] },
    }),
  );
  await Bun.write(join(extra, ".mcp.json"), "invalid additional MCP config");
  await Bun.write(
    join(extra, ".rukie/skills/additional-only/SKILL.md"),
    "---\nname: additional-only\ndescription: Additional-only skill\n---\nAdditional-only skill body",
  );
  await Bun.write(join(extra, "CLAUDE.md"), "Additional CLAUDE fallback must not load");
  await Bun.write(join(dirs.cwd, "same-name.txt"), "Primary file content");
  await Bun.write(join(extra, "same-name.txt"), "Additional file content");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "same-name.txt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const warnings: string[] = [];
  const session = await openSession({
    ...dirs,
    ...fake,
    additionalDirectories: [extra],
    settings: { trustedProjects: [dirs.cwd, extra] },
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });
  await session.run("read same-name.txt");
  const context = JSON.stringify(fake.contexts[1]!.messages);
  expect(context).toContain("Primary file content");
  expect(context).not.toContain("Additional file content");
  expect(context).not.toContain("Additional-only skill");
  expect(context).not.toContain("Additional CLAUDE fallback must not load");
  expect(await Bun.file(marker).exists()).toBe(false);
  expect(warnings).toEqual([]);
});

test("additional directory options reject relative paths before opening a Session", async () => {
  dirs = await tempDirs();
  await expect(
    createSession({ ...dirs, ...fakeModel([]), additionalDirectories: ["relative-project"] }),
  ).rejects.toThrow("Additional directories must be absolute paths.");
});

test("pre-generation reporting and Side Question use the rendered sections including tool guidance", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("side answer"),
    fauxAssistantMessage("main answer"),
  ]);
  const session = await openSession({ ...dirs, ...fake });
  const initial = session.contextUsage().segments.system;
  for await (const _ of session.sideQuestion("what environment?")) {
    /* consume to completion */
  }
  const sidePrompt = getCurrentSystemPrompt(fake.contexts[0]!.messages);
  expect(sidePrompt).toContain(`<environment>\ncwd: ${dirs.cwd}`);
  expect(sidePrompt).toContain("<instructions>");
  expect(sidePrompt).not.toContain("Use ask_user_question");
  expect(session.contextReport().categories.find((c) => c.name === "system-prompt")!.tokens).toBe(
    initial,
  );
  await session.run("main");
  expect(getCurrentSystemPrompt(fake.contexts[1]!.messages)).toBe(sidePrompt);
  expect(session.contextUsage().segments.system).toBe(initial);
});

test("registered interaction tools determine guidance and shell identifies the actual command runtime", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const session = await openSession({ ...dirs, ...fake, onQuestion: async () => "declined" });
  await session.run("hi");
  const prompt = getCurrentSystemPrompt(fake.contexts[0]!.messages);
  expect(prompt).toContain("Use ask_user_question");
  expect(prompt).toContain("Use todo_write");
  expect(prompt).toContain("shell: bash");
  const other = fakeModel([fauxAssistantMessage("done")]);
  const same = await openSession({
    ...dirs,
    ...other,
    onQuestion: async () => "declined",
    now: () => new Date("2030-01-02T12:00:00Z"),
  });
  await same.run("hi again");
  expect(getCurrentSystemPrompt(other.contexts[0]!.messages)).toBe(prompt);
});
