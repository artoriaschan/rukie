import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import type { SessionStorageLease } from "../../src/store/index.ts";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { realpath, rm, symlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import {
  createJsonlStore,
  createSession as createSessionImpl,
  type Session,
  type SessionEvent,
} from "../../src/index.ts";
import { withModelAlias } from "../helpers/auxiliary-model.ts";
import { fakeModel } from "../helpers/fake-model.ts";
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

test("conversation rewind restores live messages and Tool State, keeping code and the old branch", async () => {
  dirs = await tempDirs();
  const before = [{ content: "first task", status: "pending" }];
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("todo_write", { todos: before }), { stopReason: "toolUse" }),
    fauxAssistantMessage("first answer"),
    fauxAssistantMessage(
      [
        fauxToolCall("todo_write", { todos: [{ content: "second task", status: "completed" }] }),
        fauxToolCall("write", { path: "file.txt", content: "changed" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("second answer"),
    (context) => {
      expect(JSON.stringify(context)).toContain("first task");
      expect(JSON.stringify(context)).not.toContain("second task");
      expect(JSON.stringify(context)).not.toContain("second answer");
      expect(JSON.stringify(context)).not.toContain("You are in Plan Mode");
      return fauxAssistantMessage(
        fauxToolCall("write", { path: "file.txt", content: "replacement" }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage("new answer"),
  ]);
  const store = createJsonlStore(dirs);
  const leases: SessionStorageLease[] = [];
  const open = store.open.bind(store);
  store.open = async (...args) => {
    const lease = await open(...args);
    leases.push(lease);
    return lease;
  };
  let session = await createSession({ ...dirs, ...fake, store, permissionMode: "full-access" });
  await session.run("first prompt");
  // State written after the target prompt is also discarded.
  await session.run("  second\n prompt  ");
  await session.setPlanMode(true);
  const checkpoints = session.checkpoints();
  const storage = leases[0]!.storage;
  const original = await storage.scanEntries(
    { conversationId: ROOT_CONVERSATION_ID },
    1000,
    undefined,
    BACKGROUND_CONTEXT,
  );
  const oldTip = original.items[0]!;
  const anchorIndex = original.items.findIndex(
    (entry) => String(entry.id) === checkpoints[1]!.promptEntryId,
  );
  const anchor = original.items[anchorIndex]!;
  const prior = original.items[anchorIndex + 1]!;
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(structuredClone(event)));
  const result = await session.rewind(checkpoints[1]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  expect(result).toEqual({ prompt: "  second\n prompt  ", restored: [], deleted: [] });
  expect(await Bun.file(join(dirs.cwd, "file.txt")).text()).toBe("changed");
  expect(JSON.stringify(session.messages)).toContain("first answer");
  expect(JSON.stringify(session.messages)).not.toContain("second answer");
  expect(session.toolState("todo")).toEqual(before);
  expect(session.planMode).toBe(false);
  expect(session.toolState("plan")).toBeUndefined();
  expect(session.checkpoints()).toEqual([checkpoints[0]!]);
  const branches = await storage.scanConversations({}, 1000, undefined, BACKGROUND_CONTEXT);
  expect(
    branches.items.some(
      (branch) =>
        branch.parent?.conversationId === ROOT_CONVERSATION_ID && branch.parent.at === prior.id,
    ),
  ).toBe(true);
  expect((await storage.entry(oldTip.id, BACKGROUND_CONTEXT))!.entry).toEqual(oldTip);
  expect((await storage.entry(anchor.id, BACKGROUND_CONTEXT))!.entry).toEqual(anchor);
  expect(events.findLast((event) => event.type === "snapshot")).toMatchObject({
    type: "snapshot",
    planMode: false,
    toolStates: { todo: before },
    messages: session.messages,
  });
  await session.close();
  const resumed = await createSession({ ...dirs, ...fake, resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
  expect(resumed.toolState("todo")).toEqual(before);
  session = resumed;
  await session.run("replacement prompt");
  expect(session.checkpoints().map(({ preview }) => preview)).toEqual([
    "first prompt",
    "replacement prompt",
  ]);
  await session.rewind(session.checkpoints()[1]!.promptEntryId, {
    code: true,
    conversation: false,
  });
  expect(await Bun.file(join(dirs.cwd, "file.txt")).text()).toBe("changed");
  await session.rewind(checkpoints[0]!.promptEntryId, { code: false, conversation: true });
  expect(session.checkpoints()).toEqual([]);
  expect(session.toolState("todo")).toBeUndefined();
  expect(
    session.messages.every((message) => message.role !== "user" && message.role !== "assistant"),
  ).toBe(true);
});

test("each user prompt has a chronological Checkpoint with its own file records", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("first"),
    fauxAssistantMessage(fauxToolCall("write", { path: "new.txt", content: "new" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("second"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  expect(session.checkpoints()).toEqual([]);
  await session.run("  inspect\n  files  ");
  await session.run("write");
  const checkpoints = session.checkpoints();
  expect(checkpoints).toEqual([
    { promptEntryId: expect.any(String), preview: "inspect files", files: [] },
    {
      promptEntryId: expect.any(String),
      preview: "write",
      files: [{ path: join(await realpath(dirs.cwd), "new.txt"), backup: null }],
    },
  ]);
  expect(checkpoints[0]!.promptEntryId).not.toBe(checkpoints[1]!.promptEntryId);
  expect(session.toolState("checkpoint")).toEqual({
    checkpoints: checkpoints.map(({ preview: _preview, ...checkpoint }) => checkpoint),
  });
  expect(
    fake.contexts.some((context) => JSON.stringify(context).includes("tool-state/checkpoint")),
  ).toBe(false);
  await session.close();
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.checkpoints()).toEqual(checkpoints);
});

test("conversation rewind removes discarded child identities from subsequent model tools", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("first answer"),
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "discarded child",
        prompt: "child",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child answer"),
    fauxAssistantMessage("second answer"),
    fauxAssistantMessage(fauxToolCall("list_agents", {}), { stopReason: "toolUse" }),
    (context) => {
      expect(
        JSON.stringify(context.messages.findLast((message) => message.role === "toolResult")),
      ).toContain("(no subagents)");
      expect(JSON.stringify(context)).not.toContain("discarded child");
      return fauxAssistantMessage("listed");
    },
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("first prompt");
  await session.run("delegate");
  expect(session.toolState("subagents")).toHaveLength(1);
  await session.rewind(session.checkpoints()[1]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  expect(session.toolState("subagents")).toBeUndefined();
  await session.run("list children");
});

test("startup hook autoruns never create a user Checkpoint", async () => {
  dirs = await tempDirs();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      async () => {
        started.resolve();
        await release.promise;
        return fauxAssistantMessage("autorun answer");
      },
      fauxAssistantMessage("user answer"),
    ]),
    settings: {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              { type: "command", command: "echo hook-feedback >&2; exit 2", asyncRewake: true },
            ],
          },
        ],
      },
    },
  });
  await started.promise;
  expect(session.checkpoints()).toEqual([]);
  release.resolve();
  await session.waitForIdle();
  await session.run("real prompt");
  expect(session.checkpoints().map(({ preview }) => preview)).toEqual(["real prompt"]);
  await session.close();
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.checkpoints()).toEqual(session.checkpoints());
});

test("Stop hook continuation writes belong to the real prompt Checkpoint", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "stop.sh"),
    `input=$(cat)\ncase "$input" in *'"stop_hook_active":false'*) echo '{"decision":"block","reason":"continue from Stop"}' ;; esac\n`,
  );
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage("first answer"),
      fauxAssistantMessage(
        fauxToolCall("write", { path: "continued.txt", content: "continuation" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("finished"),
    ]),
    permissionMode: "full-access",
    settings: { hooks: { Stop: [{ hooks: [{ type: "command", command: "sh stop.sh" }] }] } },
  });
  await session.run("real prompt");
  const checkpoints = session.checkpoints();
  expect(checkpoints).toHaveLength(1);
  expect(checkpoints[0]).toMatchObject({
    preview: "real prompt",
    files: [{ path: join(await realpath(dirs.cwd), "continued.txt"), backup: null }],
  });
  expect(JSON.stringify(session.messages)).toContain("continue from Stop");
  await session.rewind(checkpoints[0]!.promptEntryId, { code: true, conversation: true });
  expect(await Bun.file(join(dirs.cwd, "continued.txt")).exists()).toBe(false);
  expect(JSON.stringify(session.messages)).not.toContain("continue from Stop");
});

test.each(["subagent", "subagent_fork"])(
  "%s completion notifications do not open Checkpoints",
  async (toolName) => {
    dirs = await tempDirs();
    const child = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
      const parent = getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
        (tool) => tool.name === "subagent",
      );
      if (!parent) {
        waiting.resolve();
        await child.promise;
        return fauxAssistantMessage("child conclusion");
      }
      return fauxAssistantMessage("waiting for child");
    };
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall(toolName, { description: "Background", prompt: "child" }), {
        stopReason: "toolUse",
      }),
      response,
      response,
      (context) => {
        expect(
          JSON.stringify(context.messages.findLast((message) => message.role === "user")),
        ).toContain("child conclusion");
        return fauxAssistantMessage(
          fauxToolCall("write", { path: "notified.txt", content: "after notification" }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("parent conclusion"),
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    const run = session.run("real parent prompt");
    await waiting.promise;
    child.resolve();
    await run;
    await session.waitForRequest(session.currentRequestId!);
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(2);
    expect(session.checkpoints()).toMatchObject([
      {
        preview: "real parent prompt",
        files: [{ path: join(await realpath(dirs.cwd), "notified.txt"), backup: null }],
      },
    ]);
    expect(session.checkpoints()).toHaveLength(1);
    await session.close();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.checkpoints()).toEqual(session.checkpoints());
    await resumed.rewind(resumed.checkpoints()[0]!.promptEntryId, {
      code: false,
      conversation: true,
    });
    expect(JSON.stringify(resumed.messages)).not.toContain("child conclusion");
  },
);

test("rewritten write and edit paths share the canonical target's first backup", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "target.txt"), "original");
  await Bun.write(join(dirs.cwd, "untouched.txt"), "untouched");
  await symlink("target.txt", join(dirs.cwd, "alias.txt"));
  await Bun.write(
    join(dirs.cwd, "rewrite.sh"),
    `cat >/dev/null\necho '{"hookSpecificOutput":{"updatedInput":{"path":"alias.txt","content":"rewritten"},"permissionDecision":"allow"}}'\n`,
  );
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "untouched.txt", content: "wrong" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        fauxToolCall("edit", { path: "target.txt", oldText: "rewritten", newText: "edited" }),
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage("done"),
    ]),
    permissionMode: "full-access",
    settings: {
      hooks: {
        PreToolUse: [{ matcher: "write", hooks: [{ type: "command", command: "sh rewrite.sh" }] }],
      },
    },
    onToolCallAllowed({ args }) {
      // The read-only observer must not change checkpoint's executed target either.
      Object.assign(args, { path: join(dirs.cwd, "untouched.txt") });
    },
  });
  await session.run("change alias");
  expect(await Bun.file(join(dirs.cwd, "target.txt")).text()).toBe("edited");
  const checkpoint = session.checkpoints()[0]!;
  expect(checkpoint.files).toEqual([
    { path: await realpath(join(dirs.cwd, "target.txt")), backup: expect.any(String) },
  ]);
  await session.rewind(checkpoint.promptEntryId, { code: true, conversation: false });
  expect(await Bun.file(join(dirs.cwd, "target.txt")).text()).toBe("original");
  expect(await Bun.file(join(dirs.cwd, "untouched.txt")).text()).toBe("untouched");
});

test.each(["home", "at", "url"] as const)(
  "hook rewritten %s paths use the executed target for backup",
  async (spelling) => {
    dirs = await tempDirs();
    const path = join(spelling === "home" ? dirs.homeDir : dirs.cwd, "file.txt");
    const rewritten =
      spelling === "home"
        ? "~/file.txt"
        : spelling === "at"
          ? "@file.txt"
          : pathToFileURL(path).href;
    await Bun.write(path, "original");
    await Bun.write(
      join(dirs.cwd, "rewrite.sh"),
      `cat >/dev/null\necho '${JSON.stringify({ hookSpecificOutput: { updatedInput: { path: rewritten, content: "changed" }, permissionDecision: "allow" } })}'\n`,
    );
    const session = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage(fauxToolCall("write", { path: "other.txt", content: "wrong" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ]),
      settings: {
        hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "sh rewrite.sh" }] }] },
      },
    });
    await session.run("write");
    expect(await Bun.file(path).text()).toBe("changed");
    const checkpoint = session.checkpoints()[0]!;
    expect(checkpoint.files).toEqual([{ path: await realpath(path), backup: expect.any(String) }]);
    await session.rewind(checkpoint.promptEntryId, { code: true, conversation: false });
    expect(await Bun.file(path).text()).toBe("original");
  },
);

test("denied file tools and bash writes do not leave file records", async () => {
  dirs = await tempDirs({ fileHistory: false });
  await Bun.write(join(dirs.cwd, "existing.txt"), "before");
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall("write", { path: "denied.txt", content: "denied" }),
          fauxToolCall("edit", { path: "existing.txt", oldText: "before", newText: "denied" }),
          fauxToolCall("bash", {
            description: "Run test command",
            command: "printf bash > bash.txt",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]),
    permissionMode: "full-access",
    settings: { permissions: { deny: ["write", "edit"] } },
  });
  await session.run("try changes");
  expect(session.checkpoints()).toMatchObject([{ files: [] }]);
  await session.rewind(session.checkpoints()[0]!.promptEntryId, {
    code: true,
    conversation: false,
  });
  expect(await Bun.file(join(dirs.cwd, "denied.txt")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "existing.txt")).text()).toBe("before");
  expect(await Bun.file(join(dirs.cwd, "bash.txt")).text()).toBe("bash");
  expect(await Bun.file(join(dirs.homeDir, ".rukie/file-history")).exists()).toBe(false);
});

test("rewinding a later prompt preserves earlier edits and returns the original prompt text", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "original");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "first" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("first done"),
    fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "second" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("second done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("first");
  const prompt = `  ${"字".repeat(85)}\n second  `;
  await session.run(prompt);
  const checkpoint = session.checkpoints()[1]!;
  expect(checkpoint.preview).toBe(`${"字".repeat(80)}…`);
  const result = await session.rewind(checkpoint.promptEntryId, {
    code: true,
    conversation: false,
  });
  expect(result.prompt).toBe(prompt);
  expect(await Bun.file(join(dirs.cwd, "file.txt")).text()).toBe("first");
  await expect(session.rewind("missing", { code: true, conversation: false })).rejects.toThrow(
    "Checkpoint not found",
  );
  await expect(
    session.rewind(checkpoint.promptEntryId, { code: false, conversation: false }),
  ).rejects.toThrow("Choose code or conversation rewind");
});

test.each([
  { code: true, conversation: false },
  { code: false, conversation: true },
  { code: true, conversation: true },
])("rewind rejects an active Run without altering files or Checkpoints (%j)", async (mode) => {
  dirs = await tempDirs();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "first" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
      async () => {
        entered.resolve();
        await release.promise;
        return fauxAssistantMessage("second done");
      },
    ]),
    permissionMode: "full-access",
  });
  await session.run("first");
  const promptEntryId = session.checkpoints()[0]!.promptEntryId;
  const run = session.run("wait");
  await entered.promise;
  const checkpoints = session.checkpoints();
  try {
    await expect(session.rewind(promptEntryId, mode)).rejects.toThrow("must be idle");
    expect(await Bun.file(join(dirs.cwd, "file.txt")).text()).toBe("first");
    expect(session.checkpoints()).toEqual(checkpoints);
  } finally {
    release.resolve();
    await run;
  }
  expect(session.running).toBe(false);
  await session.rewind(promptEntryId, { code: true, conversation: false });
  expect(await Bun.file(join(dirs.cwd, "file.txt")).exists()).toBe(false);
});

test("a failed backup prevents file execution and leaves no file record", async () => {
  dirs = await tempDirs({ fileHistory: false });
  await Bun.write(join(dirs.cwd, "file.txt"), "before");
  await Bun.write(join(dirs.homeDir, ".rukie/file-history"), "blocked directory");
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "after" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]),
    permissionMode: "full-access",
  });
  await session.run("write");
  expect(session.messages.findLast((message) => message.role === "toolResult")).toMatchObject({
    isError: true,
  });
  expect(await Bun.file(join(dirs.cwd, "file.txt")).text()).toBe("before");
  expect(session.checkpoints()).toMatchObject([{ files: [] }]);
});

test("rewind rejects while a background child is running after the parent becomes idle", async () => {
  dirs = await tempDirs();
  const release = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const isParent = getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
      (tool) => tool.name === "subagent",
    );
    if (!isParent) {
      waiting.resolve();
      await release.promise;
      return fauxAssistantMessage("child done");
    }
    return fauxAssistantMessage("waiting");
  };
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", { description: "inspect", prompt: "inspect" }),
        {
          stopReason: "toolUse",
        },
      ),
      response,
      response,
      fauxAssistantMessage("all done"),
    ]),
  });
  const run = session.run("delegate");
  await waiting.promise;
  await run;
  expect(session.running).toBe(false);
  const checkpoint = session.checkpoints()[0]!;
  try {
    await expect(
      session.rewind(checkpoint.promptEntryId, { code: true, conversation: false }),
    ).rejects.toThrow("all related work to be settled");
  } finally {
    release.resolve();
    await run;
    await session.waitForRequest(session.currentRequestId!);
  }
  expect(
    await session.rewind(checkpoint.promptEntryId, { code: true, conversation: false }),
  ).toEqual({ prompt: "delegate", restored: [], deleted: [] });
});

test.each([false, true])(
  "a missing backup fails rewind before code or conversation changes (conversation=%s)",
  async (conversation) => {
    dirs = await tempDirs();
    await Bun.write(join(dirs.cwd, "first.txt"), "first original");
    await Bun.write(join(dirs.cwd, "missing.txt"), "missing original");
    const session = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage(
          [
            fauxToolCall("write", { path: "first.txt", content: "first changed" }),
            fauxToolCall("write", { path: "new.txt", content: "new" }),
            fauxToolCall("write", { path: "missing.txt", content: "missing changed" }),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("done"),
      ]),
      permissionMode: "full-access",
    });
    await session.run("change all");
    const checkpoint = session.checkpoints()[0]!;
    const missing = checkpoint.files.find((file) => file.path.endsWith("/missing.txt"))!;
    await rm(missing.backup!);
    const messages = structuredClone(session.messages);
    await expect(
      session.rewind(checkpoint.promptEntryId, { code: true, conversation }),
    ).rejects.toThrow("Checkpoint backup missing");
    expect(await Bun.file(join(dirs.cwd, "first.txt")).text()).toBe("first changed");
    expect(await Bun.file(join(dirs.cwd, "new.txt")).text()).toBe("new");
    expect(await Bun.file(join(dirs.cwd, "missing.txt")).text()).toBe("missing changed");
    expect(session.messages).toEqual(messages);
    expect(session.checkpoints()).toEqual([checkpoint]);
  },
);

test("combined rewind restores code before publishing the restored conversation", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "original");
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "changed" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]),
    permissionMode: "full-access",
  });
  await session.run("change file");
  const checkpoint = session.checkpoints()[0]!;
  const observed: { content: string; checkpointCount: number; hasUser: boolean }[] = [];
  session.subscribe((event) => {
    if (event.type === "snapshot" && !event.messages.some((message) => message.role === "user")) {
      observed.push({
        content: readFileSync(join(dirs.cwd, "file.txt"), "utf8"),
        checkpointCount: session.checkpoints().length,
        hasUser: session.messages.some((message) => message.role === "user"),
      });
    }
  });
  const result = await session.rewind(checkpoint.promptEntryId, { code: true, conversation: true });
  expect(result).toEqual({
    prompt: "change file",
    restored: [await realpath(join(dirs.cwd, "file.txt"))],
    deleted: [],
  });
  expect(observed).toEqual([{ content: "original", checkpointCount: 0, hasUser: false }]);
});

test.each(["live", "resumed"])(
  "%s conversation rewind restores pre-compaction context and plan guidance",
  async (mode) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage("old transcript ".repeat(2000)),
      fauxAssistantMessage("compaction summary"),
      fauxAssistantMessage("second answer"),
      (context) => {
        expect(JSON.stringify(context)).toContain("You are in Plan Mode");
        expect(JSON.stringify(context)).not.toContain("compaction summary");
        expect(JSON.stringify(context)).not.toContain("second answer");
        expect(JSON.stringify(context)).not.toContain("discarded compaction context");
        return fauxAssistantMessage("replacement answer");
      },
    ]);
    fake.models = withModelAlias(fake.models, "small", ["m"], { contextWindow: 4000 });
    fake.model = fake.models.getModel("small", "m")!;
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          SessionStart: [
            {
              matcher: "compact",
              hooks: [{ type: "command", command: "echo discarded compaction context" }],
            },
          ],
        },
      },
    });
    await session.setPlanMode(true);
    await session.run("early prompt");
    await session.setPlanMode(false);
    const events: SessionEvent[] = [];
    await session.run("later prompt", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.some((event) => event.type === "compaction_end")).toBe(true);
    if (mode === "resumed") await session.close();
    const target =
      mode === "live" ? session : await createSession({ ...dirs, ...fake, resumeId: session.id });
    const first = target.checkpoints()[0]!;
    await target.rewind(first.promptEntryId, { code: false, conversation: true });
    expect(target.planMode).toBe(true);
    expect(target.toolState("plan")).toEqual({ active: true });
    expect(target.toolState("checkpoint")).toBeUndefined();
    expect(JSON.stringify(target.messages)).not.toContain("compaction summary");
    expect(JSON.stringify(target.messages)).not.toContain("old transcript");
    await target.run("replacement prompt");
    expect(target.checkpoints().map(({ preview }) => preview)).toEqual(["replacement prompt"]);
  },
);

test("resume retains Checkpoint anchors and code rewind across compaction", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "original");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "first" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("old transcript ".repeat(2000)),
    fauxAssistantMessage("summary"),
    fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "second" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  fake.models = withModelAlias(fake.models, "small", ["m"], { contextWindow: 4000 });
  fake.model = fake.models.getModel("small", "m")!;
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("first prompt");
  let compacted = false;
  await session.run("second prompt", {
    onEvent(event) {
      if (event.type === "compaction_end") compacted = true;
    },
  });
  expect(compacted).toBe(true);
  const checkpoints = session.checkpoints();
  await session.close();
  const resumed = await createSession({ ...dirs, ...fake, resumeId: session.id });
  expect(resumed.checkpoints()).toEqual(checkpoints);
  expect(
    await resumed.rewind(checkpoints[0]!.promptEntryId, { code: true, conversation: false }),
  ).toMatchObject({ prompt: "first prompt" });
  expect(await Bun.file(join(dirs.cwd, "file.txt")).text()).toBe("original");
});

test("code rewind restores the earliest original bytes across prompts and deletes new files", async () => {
  dirs = await tempDirs();
  const original = new Uint8Array([0, 255, 128, 13, 10]);
  await Bun.write(join(dirs.cwd, "bytes.bin"), original);
  await Bun.write(join(dirs.cwd, "existing.txt"), "before");
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("write", { path: "bytes.bin", content: "first" }),
        fauxToolCall("edit", { path: "existing.txt", oldText: "before", newText: "after" }),
        fauxToolCall("write", { path: "new.txt", content: "created" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("write", { path: "bytes.bin", content: "same prompt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("first done"),
    fauxAssistantMessage(fauxToolCall("write", { path: "bytes.bin", content: "second prompt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("second done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("change files");
  await session.run("change again");
  const checkpoints = session.checkpoints();
  expect(checkpoints.map(({ files }) => files.length)).toEqual([3, 1]);
  await Bun.write(join(dirs.cwd, "bytes.bin"), "manual edit");
  await Bun.write(join(dirs.cwd, "new.txt"), "manual edit of new file");
  const messages = structuredClone(session.messages);
  const state = structuredClone(session.toolState("checkpoint"));
  const result = await session.rewind(checkpoints[0]!.promptEntryId, {
    code: true,
    conversation: false,
  });
  const cwd = await realpath(dirs.cwd);
  expect(result).toEqual({
    prompt: "change files",
    restored: [join(cwd, "bytes.bin"), join(cwd, "existing.txt")],
    deleted: [join(cwd, "new.txt")],
  });
  expect(new Uint8Array(await Bun.file(join(dirs.cwd, "bytes.bin")).arrayBuffer())).toEqual(
    original,
  );
  expect(await Bun.file(join(dirs.cwd, "existing.txt")).text()).toBe("before");
  expect(await Bun.file(join(dirs.cwd, "new.txt")).exists()).toBe(false);
  expect(session.messages).toEqual(messages);
  expect(session.toolState("checkpoint")).toEqual(state);
  await session.close();
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(messages);
  expect(resumed.toolState("checkpoint")).toEqual(state);
  expect(
    await resumed.rewind(checkpoints[0]!.promptEntryId, { code: true, conversation: false }),
  ).toEqual(result);
});
