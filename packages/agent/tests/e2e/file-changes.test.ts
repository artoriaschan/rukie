import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { mkdir, rm, stat, symlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

async function changeFile(path: string, content: string | Uint8Array) {
  const previous = await stat(path);
  await Bun.write(path, content);
  await utimes(path, previous.atime, new Date(previous.mtimeMs + 1000));
}

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
const changes = (events: SessionEvent[]) =>
  events.filter((event) => event.type === "reminder_injected" && event.source === "file-changes");

test("external changes to a read file reach the next model request once as a diff", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "first\nsecond\nthird\n");
  const fake = fakeModel([
    call("read", { path: "file.txt", offset: 1, limit: 1 }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("noticed"),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("read");
  await changeFile(path, "first\nchanged\nthird\n");
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("continue", { onEvent });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining("-second\n+changed"),
  });
  expect(JSON.stringify(fake.contexts[2])).toContain("--- file.txt");
  expect(JSON.stringify(fake.contexts[2])).toContain(" third");
  events.length = 0;
  await session.run("again", { onEvent });
  expect(changes(events)).toEqual([]);
});

test("unchanged content and a changed timestamp never inject file reminders", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "unchanged\n");
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("same"),
    fauxAssistantMessage("touched"),
    fauxAssistantMessage("same again"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("read", { onEvent });
  await session.run("continue", { onEvent });
  const before = await stat(path);
  await utimes(path, before.atime, new Date(before.mtimeMs + 1000));
  await session.run("continue", { onEvent });
  await session.run("continue", { onEvent });
  expect(changes(events)).toEqual([]);
});

test("bash changes to a read file are reported within the same Run", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "before\n");
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    call("bash", { command: "printf 'after-command\n' > file.txt" }),
    fauxAssistantMessage("noticed"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  const events: SessionEvent[] = [];
  await session.run("read then run a command", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining("-before\n+after-command"),
  });
  expect(fake.contexts[2]!.messages.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: expect.stringContaining("-before\n+after-command") }],
  });
});

test.each(["write", "edit"])(
  "%s owns its new baseline and later identical external diffs still report",
  async (name) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, "file.txt");
    await Bun.write(path, "original\n");
    const args: Parameters<typeof fauxToolCall>[1] =
      name === "write"
        ? { path: "file.txt", content: "owned\n" }
        : { path: "file.txt", edits: [{ oldText: "original", newText: "owned" }] };
    const resetArgs: Parameters<typeof fauxToolCall>[1] =
      name === "write"
        ? { path: "file.txt", content: "owned\n" }
        : { path: "file.txt", edits: [{ oldText: "external", newText: "owned" }] };
    const fake = fakeModel([
      call("read", { path: "file.txt" }),
      call(name, args),
      fauxAssistantMessage("done"),
      fauxAssistantMessage("noticed"),
      call(name, resetArgs),
      fauxAssistantMessage("reset"),
      fauxAssistantMessage("noticed again"),
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    const events: SessionEvent[] = [];
    const onEvent = (event: SessionEvent) => {
      events.push(event);
    };
    await session.run("change", { onEvent });
    expect(changes(events)).toEqual([]);
    await changeFile(path, "external\n");
    await session.run("continue", { onEvent });
    await session.run("reset", { onEvent });
    await changeFile(path, "external\n");
    await session.run("continue", { onEvent });
    expect(changes(events)).toHaveLength(2);
    for (const event of changes(events))
      expect(event).toMatchObject({ content: expect.stringContaining("-owned\n+external") });
  },
);

test("deletion reports once, and a tracked recreation can later report the same deletion", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "before\n");
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("deleted"),
    fauxAssistantMessage("continued"),
    call("write", { path: "file.txt", content: "recreated\n" }),
    fauxAssistantMessage("written"),
    fauxAssistantMessage("deleted again"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("read", { onEvent });
  await rm(path);
  await session.run("continue", { onEvent });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining("Deleted: file.txt"),
  });
  events.length = 0;
  await session.run("continue", { onEvent });
  expect(changes(events)).toEqual([]);
  await session.run("recreate", { onEvent });
  expect(changes(events)).toEqual([]);
  await rm(path);
  await session.run("continue", { onEvent });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining("Deleted: file.txt"),
  });
});

test("a failed edit preserves the last successful read baseline", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "before\n");
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    async () => {
      await changeFile(path, "external\n");
      return call("edit", { path: "file.txt", edits: [{ oldText: "missing", newText: "wrong" }] });
    },
    fauxAssistantMessage("noticed"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  const events: SessionEvent[] = [];
  await session.run("read then edit", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining("-before\n+external"),
  });
  expect(await Bun.file(path).text()).toBe("external\n");
  expect(
    session.messages.find(
      (message) => message.role === "toolResult" && message.toolName === "edit",
    ),
  ).toMatchObject({ isError: true });
});

test("a diff above 4,000 characters asks for a fresh read and reports once", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "large.txt");
  await Bun.write(path, "before\n");
  const fake = fakeModel([
    call("read", { path: "large.txt" }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("noticed"),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("read");
  await changeFile(path, "large external change\n".repeat(250));
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("continue", { onEvent });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining(
      "Externally modified: large.txt. Read it again before editing.",
    ),
  });
  expect(JSON.stringify(fake.contexts[2])).not.toContain("+large external change");
  events.length = 0;
  await session.run("again", { onEvent });
  expect(changes(events)).toEqual([]);
});

test("multiple changes keep the reminder under 16,000 characters and list remaining paths once", async () => {
  dirs = await tempDirs();
  const names = Array.from({ length: 6 }, (_, index) => `file-${index + 1}.txt`);
  for (const name of names) await Bun.write(join(dirs.cwd, name), "before\n".repeat(200));
  const fake = fakeModel([
    ...names.map((path) => call("read", { path })),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("noticed"),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("read");
  for (const name of names) await changeFile(join(dirs.cwd, name), "after!\n".repeat(200));
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("continue", { onEvent });
  expect(changes(events)).toHaveLength(1);
  const event = changes(events)[0];
  expect(event?.type).toBe("reminder_injected");
  if (event?.type !== "reminder_injected") throw new Error("Missing file changes reminder");
  expect(event.content.length).toBeLessThanOrEqual(16000);
  for (const name of names.slice(0, 4)) expect(event.content).toContain(`--- ${name}`);
  for (const name of names.slice(4)) {
    expect(event.content).toContain(`Externally modified: ${name}. Read it again before editing.`);
    expect(event.content).not.toContain(`--- ${name}`);
  }
  events.length = 0;
  await session.run("again", { onEvent });
  expect(changes(events)).toEqual([]);
});

test.each([
  ["invalid UTF-8", new Uint8Array([0x61, 0xc3, 0x28, 0x0a])],
  ["binary NUL", new Uint8Array([0x61, 0x00, 0x62, 0x0a])],
])("%s changes ask for a fresh read without putting bytes in a diff", async (_name, bytes) => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "data.txt");
  await Bun.write(path, "before\n");
  const fake = fakeModel([
    call("read", { path: "data.txt" }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("noticed"),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("read");
  await changeFile(path, bytes);
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("continue", { onEvent });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining(
      "Externally modified: data.txt. Read it again before editing.",
    ),
  });
  expect(JSON.stringify(fake.contexts[2])).not.toContain("--- data.txt");
  events.length = 0;
  await session.run("again", { onEvent });
  expect(changes(events)).toEqual([]);
});

test.each(["stat", "read"])(
  "a file %s failure reports once without breaking the Run",
  async (operation) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, "unreadable.txt");
    await Bun.write(path, "before\n");
    const fake = fakeModel([
      call("read", { path: "unreadable.txt" }),
      fauxAssistantMessage("read"),
      fauxAssistantMessage("noticed"),
      fauxAssistantMessage("continued"),
      fauxAssistantMessage("recovered"),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    await session.run("read");
    const previous = await stat(path);
    await rm(path);
    if (operation === "read") {
      await mkdir(path);
      await utimes(path, previous.atime, new Date(previous.mtimeMs + 1000));
    } else {
      await symlink(path, path);
    }
    const events: SessionEvent[] = [];
    const onEvent = (event: SessionEvent) => {
      events.push(event);
    };
    await session.run("continue", { onEvent });
    expect(changes(events)).toHaveLength(1);
    expect(changes(events)[0]).toMatchObject({
      content: expect.stringContaining(
        "Externally modified: unreadable.txt. Read it again before editing.",
      ),
    });
    expect(fake.contexts).toHaveLength(3);
    events.length = 0;
    await session.run("again", { onEvent });
    expect(changes(events)).toEqual([]);
    expect(fake.contexts).toHaveLength(4);
    await rm(path, { recursive: true });
    await Bun.write(path, "recovered\n");
    await utimes(path, previous.atime, new Date(previous.mtimeMs + 2000));
    await session.run("recovered", { onEvent });
    expect(changes(events)).toHaveLength(1);
    expect(changes(events)[0]).toMatchObject({
      content: expect.stringContaining(
        "Externally modified: unreadable.txt. Read it again before editing.",
      ),
    });
    expect(JSON.stringify(fake.contexts[4])).not.toContain("--- unreadable.txt");
  },
);

test("path-only changes stay path-only after a touch until the model reads the file again", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "large.txt");
  await Bun.write(path, "before\n");
  const fake = fakeModel([
    call("read", { path: "large.txt" }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("large change"),
    fauxAssistantMessage("touched"),
    fauxAssistantMessage("small change"),
    call("read", { path: "large.txt" }),
    fauxAssistantMessage("read again"),
    fauxAssistantMessage("diff"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("read");
  const content = "large external change\n".repeat(250);
  await changeFile(path, content);
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("continue", { onEvent });
  events.length = 0;
  const before = await stat(path);
  await utimes(path, before.atime, new Date(before.mtimeMs + 1000));
  await session.run("touched", { onEvent });
  expect(changes(events)).toEqual([]);
  await changeFile(path, "small change\n" + content);
  await session.run("continue", { onEvent });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining(
      "Externally modified: large.txt. Read it again before editing.",
    ),
  });
  expect(JSON.stringify(fake.contexts[4])).not.toContain("--- large.txt");
  await session.run("read again", { onEvent });
  events.length = 0;
  await changeFile(path, "new small change\n" + content);
  await session.run("continue", { onEvent });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining("-small change\n+new small change"),
  });
});

test("changes and deletions above 16,000 characters are batched without losing or repeating files", async () => {
  dirs = await tempDirs();
  const names = Array.from({ length: 90 }, (_, index) => `file-${index}-${"x".repeat(160)}.txt`);
  for (const name of names) await Bun.write(join(dirs.cwd, name), "before\n");
  const fake = fakeModel([
    fauxAssistantMessage(
      names.map((path) => fauxToolCall("read", { path })),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("read"),
    ...Array.from({ length: 4 }, () => fauxAssistantMessage("continued")),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("read");
  for (const name of names.slice(0, 60))
    await changeFile(join(dirs.cwd, name), "large external change\n".repeat(250));
  for (const name of names.slice(60)) await rm(join(dirs.cwd, name));
  const events: SessionEvent[] = [];
  for (let request = 0; request < 4; request++) {
    await session.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
  }
  const seen = new Set<string>();
  for (const context of fake.contexts) {
    let newContentLength = 0;
    for (const message of context.messages) {
      if (message.role !== "user" || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block.type !== "text" || !block.text.startsWith("<system-reminder>\nFile changes ("))
          continue;
        const content = block.text.slice(
          "<system-reminder>\n".length,
          -"\n</system-reminder>".length,
        );
        if (seen.has(content)) continue;
        seen.add(content);
        newContentLength += content.length;
      }
    }
    expect(newContentLength).toBeLessThanOrEqual(16000);
  }
  const reminders = changes(events);
  expect(reminders.length).toBeGreaterThan(1);
  for (const event of reminders) {
    if (event.type !== "reminder_injected") throw new Error("Missing file changes reminder");
    expect(event.content.length).toBeLessThanOrEqual(16000);
    expect(event.content).not.toContain("+large external change");
  }
  for (const [index, name] of names.entries()) {
    const report = index < 60 ? `Externally modified: ${name}.` : `Deleted: ${name}`;
    expect(
      reminders.filter(
        (event) => event.type === "reminder_injected" && event.content.includes(report),
      ),
    ).toHaveLength(1);
  }
});
