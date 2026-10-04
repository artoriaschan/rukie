import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("the first Run supplies static identity, environment and both levels of Project Instructions", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.homeDir, ".neant/AGENTS.md"), "Personal coding preferences");
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Project coding conventions");
  await Bun.write(join(dirs.cwd, "CLAUDE.md"), "Ignored fallback instructions");
  expect(await Bun.spawn(["git", "init", "-b", "reminder-test"], { cwd: dirs.cwd }).exited).toBe(0);
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const events: SessionEvent[] = [];
  const session = await createSession({
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
  expect(messages[0]).toMatchObject({ role: "system", content: expect.stringContaining("Neant") });
  const reminders = events.filter((event) => event.type === "reminder_injected");
  expect(reminders.map((event) => event.source)).toEqual([
    "environment",
    "date",
    "user-instructions",
    "project-instructions",
    "skills",
  ]);
  expect(reminders[0]!.content).toContain(`cwd: ${dirs.cwd}`);
  expect(reminders[0]!.content).toContain(`platform: ${process.platform}`);
  expect(reminders[0]!.content).toContain("git branch: reminder-test");
  expect(reminders[0]!.content).toContain("?? AGENTS.md");
  expect(reminders[1]!.content).toBe("Current date: 2026-10-01");
  expect(reminders[2]!.content).toContain("Personal coding preferences");
  expect(reminders[3]!.content).toContain("Project coding conventions");
  expect(JSON.stringify(messages)).not.toContain("Ignored fallback instructions");
  expect(messages.slice(1, -1)).toEqual(
    reminders.map((event) => ({
      role: "user",
      content: [{ type: "text", text: `<system-reminder>\n${event.content}\n</system-reminder>` }],
      timestamp: expect.any(Number),
    })),
  );
  expect(messages.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "original prompt" }],
  });
  expect(events[0]!.type).toBe("session_start");
  expect(events.at(-1)!.type).toBe("result");
  expect(reminders.every((event) => event.sessionId === session.id)).toBe(true);
  expect(result.text).toBe("done");
});

async function transcript() {
  const root = join(dirs.homeDir, ".neant/sessions");
  const files = await readdir(root, { recursive: true });
  const file = files.find((path) => path.endsWith(".jsonl"))!;
  return Bun.file(join(root, file)).text();
}

test("resume preserves the model and Transcript prefix and appends changed date and Project Instructions", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Original project instructions");
  let date = new Date("2026-10-01T12:00:00Z");
  const clock = () => date;
  const fake = fakeModel([
    fauxAssistantMessage("first reply"),
    fauxAssistantMessage("second reply"),
  ]);
  const session = await createSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    ...fake,
    now: clock,
  });
  await session.run("first prompt");
  const before = await transcript();
  const storedMessages = before
    .trim()
    .split("\n")
    .flatMap((line) => {
      const writes = JSON.parse(line);
      return Array.isArray(writes) ? writes : [writes];
    })
    .filter((write) => write.kind === "entry")
    .map((write) => write.message);
  expect(storedMessages[0]).toEqual(fake.contexts[0]!.messages[0]);
  expect(storedMessages.filter((message) => message.role === "system-reminder")).toMatchObject([
    { source: "environment" },
    { source: "date", content: "Current date: 2026-10-01" },
    {
      source: "project-instructions",
      content: expect.stringContaining("Original project instructions"),
    },
    { source: "skills", content: "Available skills: none." },
  ]);
  const events: SessionEvent[] = [];
  await session.run("second prompt", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "reminder_injected")).toEqual([]);
  const prefix = structuredClone(fake.contexts[1]!.messages);
  const beforeResume = await transcript();

  date = new Date("2026-10-02T12:00:00Z");
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "New instructions must not rewrite the prefix");
  const next = fakeModel([fauxAssistantMessage("continued")]);
  const resumed = await createSession({
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
      content: [
        { type: "text", text: "<system-reminder>\nCurrent date: 2026-10-02\n</system-reminder>" },
      ],
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
  expect(events.filter((event) => event.type === "reminder_injected")).toEqual([
    {
      type: "reminder_injected",
      sessionId: session.id,
      source: "date",
      content: "Current date: 2026-10-02",
    },
    {
      type: "reminder_injected",
      sessionId: session.id,
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
    const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });
    const events: SessionEvent[] = [];
    await session.run("hi", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const instructions = events
      .filter((event) => event.type === "reminder_injected")
      .filter((event) => event.source.endsWith("instructions"));
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
      events.find((event) => event.type === "reminder_injected" && event.source === "environment"),
    ).toMatchObject({
      content: expect.stringContaining("git branch: unavailable"),
    });
  },
);

test("System Prompt is identical across projects, dates and Sessions", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("done")]);
  await (await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake })).run("hi");
  const other = fakeModel([fauxAssistantMessage("done")]);
  await Bun.write(join(dirs.homeDir, "AGENTS.md"), "Different project instructions");
  await (
    await createSession({
      cwd: dirs.homeDir,
      homeDir: dirs.homeDir,
      ...other,
      now: () => new Date("2030-01-01T12:00:00Z"),
    })
  ).run("different prompt");
  expect(other.contexts[0]!.messages[0]!.content).toEqual(fake.contexts[0]!.messages[0]!.content);
  const identity = JSON.stringify(fake.contexts[0]!.messages[0]!.content);
  expect(identity).not.toContain(dirs.cwd);
  expect(identity).not.toContain("2026-10-01");
  expect(identity).not.toContain("Different project instructions");
});

test("additional sources compare current content against the latest persisted value independently", async () => {
  dirs = await tempDirs();
  const now = () => new Date("2026-10-01T12:00:00Z");
  const fake = fakeModel([fauxAssistantMessage("first reply")]);
  const session = await createSession({
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
  const next = fakeModel([
    fauxAssistantMessage("second reply"),
    fauxAssistantMessage("third reply"),
    fauxAssistantMessage("fourth reply"),
  ]);
  const resumed = await createSession({
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
  expect(
    events
      .filter((event) => event.type === "reminder_injected")
      .map(({ source, content }) => ({ source, content })),
  ).toEqual([
    { source: "catalog", content: "Available: beta" },
    { source: "new-source", content: "New context" },
  ]);
  expect(next.contexts[0]!.messages.slice(0, fake.contexts[0]!.messages.length)).toEqual(
    fake.contexts[0]!.messages,
  );
  expect(await transcript()).toStartWith(before);
  events.length = 0;
  await resumed.run("unchanged", { onEvent });
  expect(events.filter((event) => event.type === "reminder_injected")).toEqual([]);
  catalog = "Available: alpha";
  events.length = 0;
  await resumed.run("changed back", { onEvent });
  expect(events.filter((event) => event.type === "reminder_injected")).toEqual([
    {
      type: "reminder_injected",
      sessionId: session.id,
      source: "catalog",
      content: "Available: alpha",
    },
  ]);
});
