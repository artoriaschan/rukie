import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { realpath, rm, symlink } from "node:fs/promises";
import { createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

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
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.checkpoints()).toEqual(checkpoints);
});

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
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "existing.txt"), "before");
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall("write", { path: "denied.txt", content: "denied" }),
          fauxToolCall("edit", { path: "existing.txt", oldText: "before", newText: "denied" }),
          fauxToolCall("bash", { command: "printf bash > bash.txt" }),
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
  expect(await Bun.file(join(dirs.homeDir, ".neant/file-history")).exists()).toBe(false);
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
  ).rejects.toThrow("requires code or conversation");
});

test("rewind rejects an active Run without altering files or Checkpoints", async () => {
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
    await expect(
      session.rewind(promptEntryId, { code: true, conversation: false }),
    ).rejects.toThrow("idle Session");
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
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "before");
  await Bun.write(join(dirs.homeDir, ".neant/file-history"), "blocked directory");
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

test("rewind rejects while a background child is running and the parent waits", async () => {
  dirs = await tempDirs();
  const release = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const isParent = context.messages.some(
      (message) =>
        message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
    );
    if (!isParent) {
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
  const run = session.run("delegate", {
    onEvent(event) {
      if (event.type === "subagents_waiting") waiting.resolve();
    },
  });
  await waiting.promise;
  const checkpoint = session.checkpoints()[0]!;
  try {
    await expect(
      session.rewind(checkpoint.promptEntryId, { code: true, conversation: false }),
    ).rejects.toThrow("idle Session");
  } finally {
    release.resolve();
    await run;
  }
  expect(
    await session.rewind(checkpoint.promptEntryId, { code: true, conversation: false }),
  ).toEqual({ prompt: "delegate", restored: [], deleted: [] });
});

test("a missing backup fails the whole rewind before restoring or deleting any files", async () => {
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
    session.rewind(checkpoint.promptEntryId, { code: true, conversation: false }),
  ).rejects.toThrow("Checkpoint backup missing");
  expect(await Bun.file(join(dirs.cwd, "first.txt")).text()).toBe("first changed");
  expect(await Bun.file(join(dirs.cwd, "new.txt")).text()).toBe("new");
  expect(await Bun.file(join(dirs.cwd, "missing.txt")).text()).toBe("missing changed");
  expect(session.messages).toEqual(messages);
  expect(session.checkpoints()).toEqual([checkpoint]);
});

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
  fake.model.contextWindow = 4000;
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
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
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
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(messages);
  expect(resumed.toolState("checkpoint")).toEqual(state);
  expect(
    await resumed.rewind(checkpoints[0]!.promptEntryId, { code: true, conversation: false }),
  ).toEqual(result);
});
