import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { JsonValue } from "@earendil-works/pi-agent-core/harness/session";
import { mkdir, rm, stat, symlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import {
  createJsonlStore,
  createSession,
  type SessionEvent,
  type SessionStore,
} from "../../src/index.ts";
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

function failingFileTrackingStore() {
  const base = createJsonlStore(dirs);
  let failure: "snapshot" | "reminder" | undefined;
  const store: SessionStore = {
    ...base,
    async open(...args) {
      const saved = await base.open(...args);
      const mutate: typeof saved.mutate = (work, context) =>
        saved.mutate((mutation) => {
          const commit: typeof mutation.commit = (writes, context) => {
            if (
              failure === "snapshot" &&
              writes.some(
                (write) =>
                  write.kind === "entry" &&
                  write.entry.type === "custom" &&
                  write.entry.customType === "tool-state/file-tracking",
              )
            ) {
              failure = undefined;
              throw new Error("File tracking snapshot storage failed");
            }
            return mutation.commit(writes, context);
          };
          return work(
            new Proxy(mutation, {
              get(target, key) {
                if (key === "commit") return commit;
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
            context,
          );
        }, context);
      const branch: typeof saved.branch = async (...args) => {
        const branch = await saved.branch(...args);
        if (!branch) return branch;
        const appendMessage: typeof branch.appendMessage = (message, context) => {
          if (
            failure === "reminder" &&
            message.role === "system-reminder" &&
            message.source === "file-changes"
          ) {
            failure = undefined;
            throw new Error("File change reminder storage failed");
          }
          return branch.appendMessage(message, context);
        };
        return new Proxy(branch, {
          get(target, key) {
            if (key === "appendMessage") return appendMessage;
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      };
      return new Proxy(saved, {
        get(target, key) {
          if (key === "mutate") return mutate;
          if (key === "branch") return branch;
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  return {
    store,
    failNext: (kind: typeof failure) => {
      failure = kind;
    },
  };
}

test("a rejected detection snapshot propagates its error and retries the unseen change", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "before\n");
  const faulty = failingFileTrackingStore();
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("noticed"),
  ]);
  const session = await createSession({ ...dirs, ...fake, store: faulty.store });
  await session.run("read");
  await changeFile(path, "external\n");
  faulty.failNext("snapshot");
  await expect(session.run("notice")).rejects.toThrow("File tracking snapshot storage failed");
  const events: SessionEvent[] = [];
  await session.run("retry", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining("-before\n+external"),
  });
});

test("a snapshot saved before a rejected reminder never allows an unseen diff to be overwritten after resume", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "keep\nbefore\n");
  const faulty = failingFileTrackingStore();
  const session = await createSession({
    ...dirs,
    store: faulty.store,
    ...fakeModel([call("read", { path: "file.txt" }), fauxAssistantMessage("read")]),
  });
  await session.run("read");
  await changeFile(path, "keep\nexternal\n");
  faulty.failNext("reminder");
  await expect(session.run("notice")).rejects.toThrow("File change reminder storage failed");
  await session.dispose();
  const resumed = await createSession({
    ...dirs,
    resumeId: session.id,
    permissionMode: "full-access",
    ...fakeModel([
      call("edit", { path: "file.txt", edits: [{ oldText: "keep", newText: "wrong" }] }),
      fauxAssistantMessage("refused"),
    ]),
  });
  await resumed.run("continue");
  expect(
    resumed.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "edit",
    ),
  ).toMatchObject({ isError: true });
  expect(await Bun.file(path).text()).toBe("keep\nexternal\n");
});

test("a rejected read snapshot is a tool error and cannot grant write permission before another read", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "before\n");
  const faulty = failingFileTrackingStore();
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    call("write", { path: "file.txt", content: "wrong\n" }),
    async () => {
      expect(await Bun.file(path).text()).toBe("before\n");
      return call("read", { path: "file.txt" });
    },
    call("write", { path: "file.txt", content: "owned\n" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    store: faulty.store,
    permissionMode: "full-access",
  });
  faulty.failNext("snapshot");
  await session.run("read then write");
  const results = session.messages.filter((message) => message.role === "toolResult");
  expect(results[0]).toMatchObject({
    isError: true,
    content: [{ text: "File tracking snapshot storage failed" }],
  });
  expect(results[1]).toMatchObject({ isError: true });
  expect(results[2]).toMatchObject({ isError: false });
  expect(results[3]).toMatchObject({ isError: false });
  expect(await Bun.file(path).text()).toBe("owned\n");
});

test.each(["write", "edit"])(
  "resume reports a closed-session change without a diff and %s requires a fresh read",
  async (name) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, "file.txt");
    await Bun.write(path, "keep\nbefore\n");
    const first = fakeModel([call("read", { path: "file.txt" }), fauxAssistantMessage("read")]);
    const session = await createSession({ ...dirs, ...first });
    await session.run("read");
    await session.dispose();
    await changeFile(path, "keep\nexternal\n");
    const args: Parameters<typeof fauxToolCall>[1] =
      name === "write"
        ? { path: "file.txt", content: "owned\n" }
        : { path: "file.txt", edits: [{ oldText: "keep", newText: "owned" }] };
    const next = fakeModel([
      call(name, args),
      async () => {
        expect(await Bun.file(path).text()).toBe("keep\nexternal\n");
        return call("read", { path: "file.txt" });
      },
      call(name, args),
      fauxAssistantMessage("recovered"),
    ]);
    const resumed = await createSession({
      ...dirs,
      ...next,
      resumeId: session.id,
      permissionMode: "full-access",
    });
    const events: SessionEvent[] = [];
    await resumed.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toHaveLength(1);
    expect(changes(events)[0]).toMatchObject({
      content: expect.stringContaining(
        "Externally modified: file.txt. Read it again before editing.",
      ),
    });
    expect(JSON.stringify(next.contexts[0])).not.toContain("--- file.txt");
    const results = resumed.messages.filter(
      (message) => message.role === "toolResult" && message.toolName === name,
    );
    expect(results[0]).toMatchObject({ isError: true });
    expect(results[1]).toMatchObject({ isError: false });
    expect(await Bun.file(path).text()).toBe(name === "write" ? "owned\n" : "owned\nexternal\n");
  },
);

test("resume keeps the latest reported baseline, stale guard, and distinct path-only events", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "before\n");
  const first = fakeModel([
    call("read", { path: "file.txt" }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("noticed"),
  ]);
  const session = await createSession({ ...dirs, ...first });
  await session.run("read");
  await changeFile(path, "large external change\n".repeat(250));
  await session.run("notice");
  await session.dispose();
  const next = fakeModel([
    call("write", { path: "file.txt", content: "wrong\n" }),
    fauxAssistantMessage("refused"),
    fauxAssistantMessage("noticed again"),
  ]);
  const resumed = await createSession({
    ...dirs,
    ...next,
    resumeId: session.id,
    permissionMode: "full-access",
  });
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await resumed.run("continue", { onEvent });
  expect(changes(events)).toEqual([]);
  expect(
    resumed.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "write",
    ),
  ).toMatchObject({ isError: true });
  expect(await Bun.file(path).text()).toBe("large external change\n".repeat(250));
  await changeFile(path, "another external change\n");
  await resumed.run("notice", { onEvent });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining(
      "Externally modified: file.txt. Read it again before editing.",
    ),
  });
  expect(changes(events)[0]).toMatchObject({
    content: expect.not.stringContaining("--- file.txt"),
  });
});

test("resume does not report unchanged files, owned writes, or previously reported deletion", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "unchanged.txt"), "unchanged\n");
  const deleted = join(dirs.cwd, "deleted.txt");
  await Bun.write(deleted, "before\n");
  const first = fakeModel([
    call("read", { path: "unchanged.txt" }),
    call("write", { path: "owned.txt", content: "original\n" }),
    call("edit", { path: "owned.txt", edits: [{ oldText: "original", newText: "owned" }] }),
    call("read", { path: "deleted.txt" }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("noticed"),
  ]);
  const session = await createSession({ ...dirs, ...first, permissionMode: "full-access" });
  await session.run("read and write");
  await rm(deleted);
  await session.run("notice deletion");
  await session.dispose();
  const next = fakeModel([fauxAssistantMessage("continued"), fauxAssistantMessage("noticed")]);
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await resumed.run("continue", { onEvent });
  expect(changes(events)).toEqual([]);
  await changeFile(join(dirs.cwd, "owned.txt"), "external\n");
  await resumed.run("continue", { onEvent });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining("Externally modified: owned.txt."),
  });
});

test("resume skips corrupt file-tracking snapshots with warnings and keeps the last valid baseline", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "before\n");
  const store = createJsonlStore(dirs);
  const session = await createSession({
    ...dirs,
    store,
    ...fakeModel([call("read", { path: "file.txt" }), fauxAssistantMessage("read")]),
  });
  await session.run("read");
  await session.dispose();
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT)).find(
    (item) => item.id === session.id,
  );
  if (!metadata) throw new Error("Missing saved Session");
  const stored = await store.open(metadata, BACKGROUND_CONTEXT);
  try {
    const branch = await stored.branch("main", BACKGROUND_CONTEXT);
    if (!branch) throw new Error("Missing main branch");
    const invalidFields: Record<string, JsonValue>[] = [
      { path: "" },
      { path: "relative.txt" },
      { size: -1 },
      { size: 1.5 },
      { hash: "not a SHA-256 hash" },
      { content: "must not be stored" },
    ];
    const invalidSnapshots: JsonValue[] = [
      null,
      { version: 2, value: { files: [] } },
      { version: 1, value: { files: [{ path: "file.txt" }] } },
      { version: 1, value: { files: [], content: "not allowed" } },
      ...invalidFields.map((invalid) => ({
        version: 1,
        value: {
          files: [{ path, mtimeMs: 0, size: 7, hash: "a".repeat(64), stale: false, ...invalid }],
        },
      })),
    ];
    for (const data of invalidSnapshots)
      await branch.appendCustomEntry("tool-state/file-tracking", data, BACKGROUND_CONTEXT);
  } finally {
    await stored.close(BACKGROUND_CONTEXT);
  }
  await changeFile(path, "external\n");
  const warnings: string[] = [];
  const resumed = await createSession({
    ...dirs,
    store,
    ...fakeModel([fauxAssistantMessage("noticed")]),
    resumeId: session.id,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });
  const events: SessionEvent[] = [];
  await resumed.run("continue", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(warnings).toHaveLength(10);
  expect(warnings.every((warning) => warning.includes("tool-state/file-tracking"))).toBe(true);
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining("Externally modified: file.txt."),
  });
});

test("resume preserves budget-deferred changes and deletions until each path is reported once", async () => {
  dirs = await tempDirs();
  const names = Array.from({ length: 90 }, (_, index) => `file-${index}-${"x".repeat(160)}.txt`);
  for (const name of names) await Bun.write(join(dirs.cwd, name), "before\n");
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(
        names.map((path) => fauxToolCall("read", { path })),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("read"),
      fauxAssistantMessage("first batch"),
    ]),
  });
  await session.run("read");
  for (const name of names.slice(0, 60))
    await changeFile(join(dirs.cwd, name), "large external change\n".repeat(250));
  for (const name of names.slice(60)) await rm(join(dirs.cwd, name));
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("first batch", { onEvent });
  await session.dispose();
  const resumed = await createSession({
    ...dirs,
    ...fakeModel(Array.from({ length: 3 }, () => fauxAssistantMessage("continued"))),
    resumeId: session.id,
  });
  for (let request = 0; request < 3; request++) await resumed.run("continue", { onEvent });
  const reminders = changes(events);
  expect(reminders.length).toBeGreaterThan(1);
  for (const [index, name] of names.entries()) {
    const report = index < 60 ? `Externally modified: ${name}.` : `Deleted: ${name}`;
    expect(
      reminders.filter(
        (event) => event.type === "reminder_injected" && event.content.includes(report),
      ),
    ).toHaveLength(1);
  }
});

test.each(["write", "edit"])(
  "%s refuses an unreported external change even when size and timestamp are unchanged",
  async (name) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, "file.txt");
    await Bun.write(path, "keep\nbefore\n");
    const timestamp = new Date("2026-01-01T00:00:00Z");
    await utimes(path, timestamp, timestamp);
    const fake = fakeModel([
      call("read", { path: "file.txt" }),
      async () => {
        await Bun.write(path, "keep\neditor\n");
        await utimes(path, timestamp, timestamp);
        return call(
          name,
          name === "write"
            ? { path: "file.txt", content: "owned\n" }
            : { path: "file.txt", edits: [{ oldText: "keep", newText: "owned" }] },
        );
      },
      fauxAssistantMessage("refused"),
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.run("read then change");
    expect(
      session.messages.find(
        (message) => message.role === "toolResult" && message.toolName === name,
      ),
    ).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "File has been modified since it was last read. Read it again before editing.",
        },
      ],
    });
    expect(await Bun.file(path).text()).toBe("keep\neditor\n");
  },
);

test.each(["write", "edit"])(
  "%s stays blocked after a path-only reminder and succeeds after a fresh read",
  async (name) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, "large.txt");
    await Bun.write(path, "keep\nbefore\n");
    const external = "keep\n" + "large external change\n".repeat(250);
    const args: Parameters<typeof fauxToolCall>[1] =
      name === "write"
        ? { path: "large.txt", content: "owned\n" }
        : { path: "large.txt", edits: [{ oldText: "keep", newText: "owned" }] };
    const fake = fakeModel([
      call("read", { path: "large.txt" }),
      fauxAssistantMessage("read"),
      call(name, args),
      async () => {
        expect(await Bun.file(path).text()).toBe(external);
        return call("read", { path: "large.txt" });
      },
      call(name, args),
      fauxAssistantMessage("recovered"),
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.run("read");
    await changeFile(path, external);
    const events: SessionEvent[] = [];
    await session.run("change", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const results = session.messages.filter(
      (message) => message.role === "toolResult" && message.toolName === name,
    );
    expect(results[0]).toMatchObject({
      isError: true,
      content: [
        {
          text: "File has been modified since it was last read. Read it again before editing.",
        },
      ],
    });
    expect(results[1]).toMatchObject({ isError: false });
    expect(await Bun.file(path).text()).toBe(
      name === "write" ? "owned\n" : "owned\n" + "large external change\n".repeat(250),
    );
    expect(changes(events)).toHaveLength(1);
    expect(changes(events)[0]).toMatchObject({
      content: expect.stringContaining("Externally modified: large.txt."),
    });
  },
);

test("a reported diff lets edit preserve the known external change", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "keep\nbefore\n");
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    fauxAssistantMessage("read"),
    call("edit", { path: "file.txt", edits: [{ oldText: "keep", newText: "owned" }] }),
    fauxAssistantMessage("edited"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("read");
  await changeFile(path, "keep\neditor\n");
  const events: SessionEvent[] = [];
  await session.run("edit", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(changes(events)).toHaveLength(1);
  expect(changes(events)[0]).toMatchObject({
    content: expect.stringContaining("-before\n+editor"),
  });
  expect(
    session.messages.find(
      (message) => message.role === "toolResult" && message.toolName === "edit",
    ),
  ).toMatchObject({ isError: false });
  expect(await Bun.file(path).text()).toBe("owned\neditor\n");
});

test("write creates an untracked file and edit keeps its original matching behavior", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "new.txt");
  const existing = join(dirs.cwd, "existing.txt");
  await Bun.write(existing, "before\n");
  const fake = fakeModel([
    call("edit", { path: "existing.txt", edits: [{ oldText: "missing", newText: "wrong" }] }),
    call("edit", { path: "existing.txt", edits: [{ oldText: "before", newText: "edited" }] }),
    call("write", { path: "new.txt", content: "created\n" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("create and edit");
  const results = session.messages.filter((message) => message.role === "toolResult");
  expect(results[0]).toMatchObject({ isError: true });
  expect(JSON.stringify(results[0])).not.toContain("File has been modified since");
  expect(results[1]).toMatchObject({ isError: false });
  expect(results[2]).toMatchObject({ isError: false });
  expect(await Bun.file(existing).text()).toBe("edited\n");
  expect(await Bun.file(path).text()).toBe("created\n");
});

test("a hook-rewritten write checks the final target before overwriting it", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "before\n");
  await Bun.write(
    join(dirs.cwd, "rewrite.sh"),
    `cat > /dev/null\nprintf '%s' '{"hookSpecificOutput":{"updatedInput":{"path":"file.txt","content":"wrong\\n"}}}'\n`,
  );
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    async () => {
      await changeFile(path, "external\n");
      return call("write", { path: "other.txt", content: "wrong\n" });
    },
    fauxAssistantMessage("refused"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        PreToolUse: [{ matcher: "write", hooks: [{ type: "command", command: "sh rewrite.sh" }] }],
      },
    },
  });
  await session.run("read then write");
  expect(
    session.messages.find(
      (message) => message.role === "toolResult" && message.toolName === "write",
    ),
  ).toMatchObject({
    isError: true,
    content: [
      {
        text: "File has been modified since it was last read. Read it again before editing.",
      },
    ],
  });
  expect(await Bun.file(path).text()).toBe("external\n");
  expect(await Bun.file(join(dirs.cwd, "other.txt")).exists()).toBe(false);
});

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
