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
  let skip = 0;
  const store: SessionStore = {
    ...base,
    async open(...args) {
      const saved = await base.open(...args);
      const mutate: typeof saved.mutate = (work, context) =>
        saved.mutate((mutation) => {
          const commit: typeof mutation.commit = (writes, context) => {
            if (
              failure === "reminder" &&
              writes.some(
                (write) =>
                  write.kind === "entry" &&
                  write.entry.type === "message" &&
                  write.entry.message.role === "system-reminder" &&
                  write.entry.message.source === "file-changes",
              )
            ) {
              failure = undefined;
              throw new Error("File change reminder storage failed");
            }
            if (
              failure === "snapshot" &&
              writes.some(
                (write) =>
                  write.kind === "entry" &&
                  write.entry.type === "custom" &&
                  write.entry.customType === "tool-state/file-tracking",
              )
            ) {
              if (skip-- > 0) return mutation.commit(writes, context);
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
      return new Proxy(saved, {
        get(target, key) {
          if (key === "mutate") return mutate;
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  return {
    store,
    failNext: (kind: typeof failure, skipCount = 0) => {
      failure = kind;
      skip = skipCount;
    },
  };
}

test.each([{ add: true }, { add: false }])(
  "a UTF-8 BOM-only change appears in the diff (add: $add)",
  async ({ add }) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, "file.txt");
    await Bun.write(path, add ? "text\n" : "\ufefftext\n");
    const fake = fakeModel([
      call("read", { path: "file.txt" }),
      fauxAssistantMessage("read"),
      fauxAssistantMessage("noticed"),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    await session.run("read");
    await changeFile(path, add ? "\ufefftext\n" : "text\n");
    const events: SessionEvent[] = [];
    await session.run("notice", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toMatchObject([
      {
        content: expect.stringContaining(add ? "-text\n+\ufefftext\n" : "-\ufefftext\n+text\n"),
      },
    ]);
    expect(JSON.stringify(fake.contexts.at(-1))).toContain(add ? "+\ufefftext" : "-\ufefftext");
  },
);

test.each([
  { kind: "diff", resume: false },
  { kind: "diff", resume: true },
  { kind: "path-only", resume: false },
  { kind: "path-only", resume: true },
  { kind: "deletion", resume: false },
  { kind: "deletion", resume: true },
])(
  "a final snapshot failure cannot duplicate a $kind reminder (resume: $resume)",
  async ({ kind, resume }) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, "file.txt");
    await Bun.write(path, "before\n");
    const faulty = failingFileTrackingStore();
    let fake = fakeModel([
      call("read", { path: "file.txt" }),
      fauxAssistantMessage("read"),
      fauxAssistantMessage("noticed"),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({ ...dirs, store: faulty.store, ...fake });
    await session.run("read");
    if (kind === "deletion") await rm(path);
    else
      await changeFile(
        path,
        kind === "path-only" ? "large external change\n".repeat(250) : "external\n",
      );
    faulty.failNext("snapshot", 1);
    await expect(session.run("notice")).rejects.toThrow("File tracking snapshot storage failed");
    if (resume) {
      await session.dispose();
      fake = fakeModel([fauxAssistantMessage("noticed"), fauxAssistantMessage("done")]);
    }
    const retried = resume
      ? await createSession({ ...dirs, ...fake, resumeId: session.id })
      : session;
    const events: SessionEvent[] = [];
    await retried.run("retry", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const firstContext = JSON.stringify(fake.contexts.at(-1));
    expect(firstContext.split("The following files were modified since").length - 1).toBe(1);
    expect(firstContext).toContain("file.txt");
    const report =
      kind === "deletion"
        ? "Deleted: file.txt"
        : kind === "diff" && !resume
          ? "-before\n+external"
          : "Externally modified: file.txt.";
    expect(changes(events)).toMatchObject([{ content: expect.stringContaining(report) }]);
    events.length = 0;
    await retried.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toHaveLength(0);
  },
);

test.each([{ during: "request preparation" }, { during: "compaction" }])(
  "a final snapshot rejected during $during resumes with one report",
  async ({ during }) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, "file.txt");
    await Bun.write(path, "before\n");
    const faulty = failingFileTrackingStore();
    const fake = fakeModel([
      call("read", { path: "file.txt" }),
      during === "compaction"
        ? fauxAssistantMessage("read")
        : async () => {
            await changeFile(path, "external\n");
            faulty.failNext("snapshot", 1);
            return call("bash", { description: "Run test command", command: "true" });
          },
      fauxAssistantMessage("summary"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      store: faulty.store,
      permissionMode: "full-access",
    });
    const failedEvents: SessionEvent[] = [];
    if (during === "compaction") {
      await session.run("read");
      await changeFile(path, "external\n");
      faulty.failNext("snapshot", 1);
      const unsubscribe = session.subscribe((event) => {
        failedEvents.push(event);
      });
      await expect(session.compact()).rejects.toThrow("File tracking snapshot storage failed");
      unsubscribe();
    } else {
      await expect(
        session.run("read then notice", {
          onEvent: (event) => {
            failedEvents.push(event);
          },
        }),
      ).rejects.toThrow("File tracking snapshot storage failed");
    }
    expect(changes(failedEvents)).toHaveLength(0);
    await session.dispose();
    const next = fakeModel([fauxAssistantMessage("noticed"), fauxAssistantMessage("done")]);
    const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
    const events: SessionEvent[] = [];
    await resumed.run("retry", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toMatchObject([
      { content: expect.stringContaining("Externally modified: file.txt.") },
    ]);
    expect(
      JSON.stringify(next.contexts[0]).split("The following files were modified since").length - 1,
    ).toBe(1);
    events.length = 0;
    await resumed.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toHaveLength(0);
  },
);

test("a completed compaction request releases the file budget before reporting deferred changes", async () => {
  dirs = await tempDirs();
  const names = Array.from({ length: 90 }, (_, index) => `file-${index}-${"x".repeat(160)}.txt`);
  for (const name of names) await Bun.write(join(dirs.cwd, name), "before\n");
  const fake = fakeModel([
    fauxAssistantMessage(
      names.map((path) => fauxToolCall("read", { path })),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("File knowledge summary."),
    fauxAssistantMessage("noticed"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("read");
  for (const name of names)
    await changeFile(join(dirs.cwd, name), "large external change\n".repeat(250));
  fake.model.contextWindow = 6000;
  const events: SessionEvent[] = [];
  await session.run("notice", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.some((event) => event.type === "compaction_end")).toBe(true);
  const reports = changes(events);
  expect(reports).toHaveLength(2);
  for (const name of names) {
    expect(
      reports.filter(
        (event) =>
          event.type === "reminder_injected" &&
          event.content.includes(`Externally modified: ${name}.`),
      ),
    ).toHaveLength(1);
  }
  for (const event of reports) {
    if (event.type !== "reminder_injected") throw new Error("Missing file changes reminder");
    expect(event.content.length).toBeLessThanOrEqual(16000);
  }
  const deferred = reports[1];
  if (deferred?.type !== "reminder_injected")
    throw new Error("Missing deferred file changes reminder");
  expect(JSON.stringify(fake.contexts.at(-1))).toContain(
    JSON.stringify(deferred.content).slice(1, -1),
  );
});

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

test.each([{ resume: false }, { resume: true }])(
  "a deleted file retries a rejected reminder once (resume: $resume)",
  async ({ resume }) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, "file.txt");
    await Bun.write(path, "before\n");
    const faulty = failingFileTrackingStore();
    let fake = fakeModel([
      call("read", { path: "file.txt" }),
      fauxAssistantMessage("read"),
      fauxAssistantMessage("noticed"),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({
      ...dirs,
      store: faulty.store,
      ...fake,
    });
    await session.run("read");
    await rm(path);
    faulty.failNext("reminder");
    await expect(session.run("notice")).rejects.toThrow("File change reminder storage failed");
    if (resume) {
      await session.dispose();
      fake = fakeModel([fauxAssistantMessage("noticed"), fauxAssistantMessage("done")]);
    }
    const retried = resume
      ? await createSession({ ...dirs, resumeId: session.id, ...fake })
      : session;
    const events: SessionEvent[] = [];
    await retried.run("retry", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toMatchObject([
      { content: expect.stringContaining("Deleted: file.txt") },
    ]);
    expect(JSON.stringify(fake.contexts.at(-1))).toContain("Deleted: file.txt");
    expect(
      JSON.stringify(fake.contexts.at(-1)).split("The following files were modified since").length -
        1,
    ).toBe(1);
    events.length = 0;
    await retried.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toHaveLength(0);
  },
);

test.each([
  { resume: false, large: false },
  { resume: true, large: false },
  { resume: false, large: true },
  { resume: true, large: true },
])(
  "a rejected change reminder retries once and preserves knowledge (resume: $resume, large: $large)",
  async ({ resume, large }) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, "file.txt");
    await Bun.write(path, "keep\nbefore\n");
    const faulty = failingFileTrackingStore();
    const edit = call("edit", { path: "file.txt", edits: [{ oldText: "keep", newText: "owned" }] });
    const next = [edit, fauxAssistantMessage("noticed"), fauxAssistantMessage("done")];
    let fake = fakeModel([
      call("read", { path: "file.txt" }),
      fauxAssistantMessage("read"),
      ...next,
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      store: faulty.store,
      permissionMode: "full-access",
    });
    await session.run("read");
    const external = "keep\n" + (large ? "large external change\n".repeat(250) : "external\n");
    await changeFile(path, external);
    faulty.failNext("reminder");
    await expect(session.run("notice")).rejects.toThrow("File change reminder storage failed");
    if (resume) {
      await session.dispose();
      fake = fakeModel(next);
    }
    const retried = resume
      ? await createSession({
          ...dirs,
          ...fake,
          resumeId: session.id,
          permissionMode: "full-access",
        })
      : session;
    const events: SessionEvent[] = [];
    await retried.run("retry and edit", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const pathOnly = resume || large;
    expect(changes(events)).toMatchObject([
      {
        content: expect.stringContaining(
          pathOnly ? "Externally modified: file.txt." : "-before\n+external",
        ),
      },
    ]);
    expect(JSON.stringify(fake.contexts.at(-2))).toContain(
      pathOnly ? "Externally modified: file.txt." : "+external",
    );
    expect(
      JSON.stringify(fake.contexts.at(-2)).split("The following files were modified since").length -
        1,
    ).toBe(1);
    expect(
      retried.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "edit",
      ),
    ).toMatchObject({ isError: pathOnly });
    expect(await Bun.file(path).text()).toBe(pathOnly ? external : "owned\nexternal\n");
    events.length = 0;
    await retried.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toHaveLength(0);
    await retried.dispose();
    const reopened = await createSession({
      ...dirs,
      resumeId: retried.id,
      ...fakeModel([fauxAssistantMessage("done")]),
    });
    await reopened.run("continue after resume", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toHaveLength(0);
  },
);

test.each([{ during: "prompt" }, { during: "manual compaction" }])(
  "a reminder rejected during $during releases its near-full budget for the next Run",
  async ({ during }) => {
    dirs = await tempDirs();
    const names = Array.from({ length: 90 }, (_, index) => `file-${index}-${"x".repeat(160)}.txt`);
    for (const name of names) await Bun.write(join(dirs.cwd, name), "before\n");
    const faulty = failingFileTrackingStore();
    const session = await createSession({
      ...dirs,
      store: faulty.store,
      ...fakeModel([
        fauxAssistantMessage(
          names.map((path) => fauxToolCall("read", { path })),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("read"),
        ...(during === "manual compaction"
          ? [fauxAssistantMessage("File knowledge summary.")]
          : []),
        fauxAssistantMessage("noticed"),
        fauxAssistantMessage("noticed deferred files"),
        fauxAssistantMessage("done"),
      ]),
    });
    await session.run("read");
    for (const name of names)
      await changeFile(join(dirs.cwd, name), "large external change\n".repeat(250));
    faulty.failNext("reminder");
    await expect(during === "prompt" ? session.run("notice") : session.compact()).rejects.toThrow(
      "File change reminder storage failed",
    );
    const events: SessionEvent[] = [];
    await session.run("retry", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toHaveLength(1);
    const reminder = changes(events)[0];
    if (reminder?.type !== "reminder_injected") throw new Error("Missing file changes reminder");
    const firstBatch = names.filter((name) =>
      reminder.content.includes(`Externally modified: ${name}.`),
    );
    expect(firstBatch.length).toBeGreaterThan(0);
    expect(firstBatch.length).toBeLessThan(names.length);
    expect(reminder.content.length).toBeGreaterThan(15000);
    expect(reminder.content.length).toBeLessThanOrEqual(16000);
    await session.run("notice deferred files", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const batches = changes(events);
    expect(batches).toHaveLength(2);
    for (const name of names) {
      expect(
        batches.filter(
          (event) =>
            event.type === "reminder_injected" &&
            event.content.includes(`Externally modified: ${name}.`),
        ),
      ).toHaveLength(1);
    }
    events.length = 0;
    await session.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toHaveLength(0);
  },
);

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
    call("bash", {
      description: "Run test command",
      command: "printf 'after-command\n' > file.txt",
    }),
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

test("code and conversation rewind restore the known files and discard reads from the abandoned prompt", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  const abandoned = join(dirs.cwd, "abandoned.txt");
  await Bun.write(path, "original\n");
  await Bun.write(abandoned, "unread\n");
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    fauxAssistantMessage("read original"),
    call("write", { path: "file.txt", content: "changed\n" }),
    call("read", { path: "abandoned.txt" }),
    fauxAssistantMessage("changed and read"),
    fauxAssistantMessage("restored"),
    fauxAssistantMessage("noticed later"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("read original");
  await session.run("change and read another file");
  await session.rewind(session.checkpoints()[1]!.promptEntryId, { code: true, conversation: true });
  await changeFile(abandoned, "external abandoned change\n");
  const events: SessionEvent[] = [];
  await session.run("continue from original", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(await Bun.file(path).text()).toBe("original\n");
  expect(changes(events)).toHaveLength(0);
  await changeFile(path, "external original change\n");
  await session.run("notice later", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(changes(events)).toMatchObject([
    { content: expect.stringContaining("Externally modified: file.txt.") },
  ]);
  expect(JSON.stringify(changes(events))).not.toContain("abandoned.txt");
  expect(JSON.stringify(changes(events))).not.toContain("--- file.txt");
});

test("compaction preserves file diff knowledge without reinjecting an old file change event", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "original\n");
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("saw first change"),
    fauxAssistantMessage("File knowledge summary."),
    fauxAssistantMessage("saw second change"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("read");
  await changeFile(path, "first external change\n");
  await session.run("notice first change");
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  await session.compact();
  expect(changes(events)).toHaveLength(0);
  await changeFile(path, "second external change\n");
  await session.run("notice second change");
  expect(changes(events)).toMatchObject([
    { content: expect.stringContaining("-first external change\n+second external change") },
  ]);
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("+second external change");
});

test("code rewind reports restored bytes as an external diff while keeping the conversation", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "original\n");
  const fake = fakeModel([
    call("write", { path: "file.txt", content: "agent change\n" }),
    fauxAssistantMessage("wrote"),
    fauxAssistantMessage("noticed restore"),
    fauxAssistantMessage("unchanged"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("change file");
  await session.rewind(session.checkpoints()[0]!.promptEntryId, {
    code: true,
    conversation: false,
  });
  const events: SessionEvent[] = [];
  await session.run("notice restore", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(changes(events)).toMatchObject([
    { content: expect.stringContaining("-agent change\n+original") },
  ]);
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("wrote");
  events.length = 0;
  await session.run("unchanged", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(changes(events)).toHaveLength(0);
});

test("conversation rewind retains matching file content and forgets discarded reads", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  const abandoned = join(dirs.cwd, "abandoned.txt");
  await Bun.write(path, "original\n");
  await Bun.write(abandoned, "unread\n");
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      call("read", { path: "file.txt" }),
      fauxAssistantMessage("read original"),
      call("read", { path: "abandoned.txt" }),
      fauxAssistantMessage("read another file"),
      fauxAssistantMessage("noticed retained file"),
    ]),
  });
  await session.run("read original");
  await session.run("read another file");
  await session.rewind(session.checkpoints()[1]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  await changeFile(path, "retained external change\n");
  await changeFile(abandoned, "discarded external change\n");
  const events: SessionEvent[] = [];
  await session.run("notice", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(changes(events)).toMatchObject([
    { content: expect.stringContaining("-original\n+retained external change") },
  ]);
  expect(JSON.stringify(changes(events))).not.toContain("abandoned.txt");
});

test.each(["subagent", "subagent_fork"])(
  "%s has independent reads and its writes are reported to the parent's next request",
  async (toolName) => {
    dirs = await tempDirs();
    const shared = join(dirs.cwd, "shared.txt");
    const childOnly = join(dirs.cwd, "child-only.txt");
    await Bun.write(shared, "parent original\n");
    await Bun.write(childOnly, "child original\n");
    const fake = fakeModel([
      call("read", { path: "shared.txt" }),
      fauxAssistantMessage("parent read"),
      call(toolName, {
        description: "Change shared file",
        prompt: "write and inspect",
        run_in_background: false,
      }),
      call("write", { path: "shared.txt", content: "child wrote new content\n" }),
      call("read", { path: "child-only.txt" }),
      fauxAssistantMessage("child done"),
      fauxAssistantMessage("parent noticed"),
      fauxAssistantMessage("parent unchanged"),
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.run("read shared file");
    const events: SessionEvent[] = [];
    await session.run("delegate", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toMatchObject([
      { content: expect.stringContaining("-parent original\n+child wrote new content") },
    ]);
    expect(
      events.some(
        (event) =>
          event.type === "subagent_event" &&
          event.event.type === "reminder_injected" &&
          event.event.source === "file-changes",
      ),
    ).toBe(false);
    expect(JSON.stringify(fake.contexts.at(-1))).toContain("+child wrote new content");
    await changeFile(childOnly, "external child-only change\n");
    events.length = 0;
    await session.run("check parent", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(changes(events)).toHaveLength(0);
  },
);

test("a PostToolUse formatter change reaches the next request and edit uses the formatted content", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "original\n");
  await Bun.write(
    join(dirs.cwd, "formatter.ts"),
    `import { stat, utimes } from "node:fs/promises";
const input = JSON.parse(await Bun.stdin.text());
await Bun.write("formatter-input.json", JSON.stringify(input));
const metadata = await stat(input.tool_input.path);
await Bun.write(input.tool_input.path, "formatted content\\n");
await utimes(input.tool_input.path, metadata.atime, new Date(metadata.mtimeMs + 1000));
`,
  );
  const fake = fakeModel([
    call("write", { path: "file.txt", content: "unformatted content\n" }),
    call("edit", {
      path: "file.txt",
      edits: [{ oldText: "formatted content", newText: "final content" }],
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        PostToolUse: [
          { matcher: "write", hooks: [{ type: "command", command: "bun formatter.ts" }] },
        ],
      },
    },
  });
  const events: SessionEvent[] = [];
  await session.run("write and edit formatted file", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(await Bun.file(join(dirs.cwd, "formatter-input.json")).json()).toMatchObject({
    hook_event_name: "PostToolUse",
    tool_name: "write",
  });
  expect(changes(events)).toMatchObject([
    { content: expect.stringContaining("-unformatted content\n+formatted content") },
  ]);
  expect(JSON.stringify(fake.contexts[1])).toContain("+formatted content");
  expect(
    session.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "edit",
    ),
  ).toMatchObject({ isError: false });
  expect(await Bun.file(path).text()).toBe("final content\n");
});

test("conversation rewind retries a rejected diff before edit uses the known external content", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, "file.txt");
  await Bun.write(path, "keep\noriginal\n");
  const faulty = failingFileTrackingStore();
  const fake = fakeModel([
    call("read", { path: "file.txt" }),
    fauxAssistantMessage("read"),
    fauxAssistantMessage("anchor"),
    call("edit", { path: "file.txt", edits: [{ oldText: "keep", newText: "owned" }] }),
    fauxAssistantMessage("edited"),
  ]);
  const session = await createSession({
    ...dirs,
    store: faulty.store,
    permissionMode: "full-access",
    ...fake,
  });
  await session.run("read");
  await session.run("anchor before external change");
  const anchor = session.checkpoints()[1]!.promptEntryId;
  await changeFile(path, "keep\nunseen external change\n");
  faulty.failNext("reminder");
  await expect(session.run("notice")).rejects.toThrow("File change reminder storage failed");
  await session.rewind(anchor, { code: false, conversation: true });
  const events: SessionEvent[] = [];
  await session.run("try edit", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(changes(events)).toMatchObject([
    { content: expect.stringContaining("-original\n+unseen external change") },
  ]);
  expect(JSON.stringify(fake.contexts[3])).toContain("+unseen external change");
  expect(
    session.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "edit",
    ),
  ).toMatchObject({ isError: false });
  expect(await Bun.file(path).text()).toBe("owned\nunseen external change\n");
});
