import { runRequest } from "../helpers/crashed-subagents.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each(["subagent", "subagent_fork"])(
  "%s file writes belong to the parent's Checkpoint and code rewind",
  async (toolName) => {
    dirs = await tempDirs();
    await Bun.write(join(dirs.cwd, "existing.txt"), "original");
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage(
          fauxToolCall(toolName, {
            description: "Change files",
            prompt: "change files",
            run_in_background: false,
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(
          [
            fauxToolCall("edit", {
              path: "existing.txt",
              oldText: "original",
              newText: "child edit",
            }),
            fauxToolCall("write", { path: "created.txt", content: "child created" }),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("child done"),
        fauxAssistantMessage("parent done"),
      ]),
      permissionMode: "full-access",
    });
    expect(
      (
        await runRequest(session, "delegate changes", {
          onEvent: (event) => {
            events.push(event);
          },
        })
      ).success,
    ).toBe(true);
    expect(await Bun.file(join(dirs.cwd, "existing.txt")).text()).toBe("child edit");
    expect(await Bun.file(join(dirs.cwd, "created.txt")).text()).toBe("child created");
    const cwd = await realpath(dirs.cwd);
    const checkpoint = session.checkpoints()[0]!;
    expect(session.checkpoints()).toEqual([
      {
        promptEntryId: expect.any(String),
        preview: "delegate changes",
        files: [
          { path: join(cwd, "existing.txt"), backup: expect.any(String) },
          { path: join(cwd, "created.txt"), backup: null },
        ],
      },
    ]);
    expect(session.toolState("checkpoint")).toMatchObject({
      checkpoints: [{ promptEntryId: checkpoint.promptEntryId, files: checkpoint.files }],
    });
    expect(
      events.filter((event) => event.type === "tool_state_changed" && event.name === "checkpoint"),
    ).toHaveLength(3);
    expect(
      events.some(
        (event) =>
          event.type === "subagent_event" &&
          event.event.type === "tool_state_changed" &&
          event.event.name === "checkpoint",
      ),
    ).toBe(false);
    const children = session.toolState("subagents") as { id: string }[];
    expect(children).toHaveLength(1);
    expect(
      (await session.readSubagent(children[0]!.id))?.messages.some(
        (message) => message.role === "toolResult" && message.toolName === "write",
      ),
    ).toBe(true);
    expect(
      await session.rewind(checkpoint.promptEntryId, { code: true, conversation: false }),
    ).toEqual({
      prompt: "delegate changes",
      restored: [join(cwd, "existing.txt")],
      deleted: [join(cwd, "created.txt")],
    });
    expect(await Bun.file(join(dirs.cwd, "existing.txt")).text()).toBe("original");
    expect(await Bun.file(join(dirs.cwd, "created.txt")).exists()).toBe(false);
    await session.close();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.checkpoints()).toEqual([checkpoint]);
  },
);

test.each([
  ["subagent", "parent"],
  ["subagent", "child"],
  ["subagent_fork", "parent"],
  ["subagent_fork", "child"],
])("%s shares the first backup when the %s writes first", async (toolName, first) => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "shared.txt"), "original");
  await symlink("shared.txt", join(dirs.cwd, "alias.txt"));
  const parentEdit = fauxAssistantMessage(
    fauxToolCall("edit", {
      path: "shared.txt",
      oldText: first === "parent" ? "original" : "child",
      newText: "parent",
    }),
    { stopReason: "toolUse" },
  );
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      ...(first === "parent" ? [parentEdit] : []),
      fauxAssistantMessage(
        fauxToolCall(toolName, {
          description: "Change shared file",
          prompt: "change alias",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("write", { path: "alias.txt", content: "child" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("child done"),
      ...(first === "child" ? [parentEdit] : []),
      fauxAssistantMessage("parent done"),
    ]),
    permissionMode: "full-access",
  });
  await runRequest(session, "change together");
  expect(await Bun.file(join(dirs.cwd, "shared.txt")).text()).toBe(
    first === "parent" ? "child" : "parent",
  );
  const checkpoint = session.checkpoints()[0]!;
  expect(checkpoint.files).toEqual([
    { path: await realpath(join(dirs.cwd, "shared.txt")), backup: expect.any(String) },
  ]);
  await session.rewind(checkpoint.promptEntryId, { code: true, conversation: false });
  expect(await Bun.file(join(dirs.cwd, "shared.txt")).text()).toBe("original");
});

test.each(["subagent", "subagent_fork"])(
  "background %s writes while the parent waits belong to the initiating prompt",
  async (toolName) => {
    dirs = await tempDirs();
    const waiting = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
      const last = context.messages.at(-1);
      const isParent = last?.role === "toolResult" && last.toolName === toolName;
      if (isParent) return fauxAssistantMessage("parent waiting");
      await release.promise;
      return fauxAssistantMessage(fauxToolCall("write", { path: "late.txt", content: "child" }), {
        stopReason: "toolUse",
      });
    };
    const session = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage("inspected"),
        fauxAssistantMessage(
          fauxToolCall(toolName, { description: "Late write", prompt: "write later" }),
          {
            stopReason: "toolUse",
          },
        ),
        response,
        response,
        fauxAssistantMessage("child done"),
        fauxAssistantMessage("parent done"),
      ]),
      permissionMode: "full-access",
    });
    await runRequest(session, "inspect");
    let settled = false;
    const run = runRequest(session, "delegate late write", {
      onEvent(event) {
        if (event.type === "run_end") waiting.resolve();
      },
    }).then((result) => {
      settled = true;
      return result;
    });
    await waiting.promise;
    const checkpoint = session.checkpoints()[1]!;
    try {
      expect(settled).toBe(false);
      expect(checkpoint.files).toEqual([]);
      await expect(
        session.rewind(checkpoint.promptEntryId, { code: true, conversation: false }),
      ).rejects.toThrow("related work to be settled");
    } finally {
      release.resolve();
      await run;
    }
    expect(await Bun.file(join(dirs.cwd, "late.txt")).text()).toBe("child");
    const cwd = await realpath(dirs.cwd);
    expect(session.checkpoints()).toEqual([
      { promptEntryId: expect.any(String), preview: "inspect", files: [] },
      {
        promptEntryId: checkpoint.promptEntryId,
        preview: "delegate late write",
        files: [{ path: join(cwd, "late.txt"), backup: null }],
      },
    ]);
    expect(
      await session.rewind(checkpoint.promptEntryId, { code: true, conversation: false }),
    ).toEqual({
      prompt: "delegate late write",
      restored: [],
      deleted: [join(cwd, "late.txt")],
    });
    expect(await Bun.file(join(dirs.cwd, "late.txt")).exists()).toBe(false);
  },
);

test.each([
  ["subagent", "existing"],
  ["subagent", "resumed"],
  ["subagent_fork", "existing"],
  ["subagent_fork", "resumed"],
] as const)(
  "%s continued by send_message in an %s parent records in the new prompt",
  async (toolName, lifecycle) => {
    const resume = lifecycle === "resumed";
    dirs = await tempDirs();
    await Bun.write(join(dirs.cwd, "later.txt"), "original");
    const events: SessionEvent[] = [];
    const continuedResponse: Parameters<typeof fakeModel>[0][number] = (context) => {
      const last = context.messages.at(-1);
      if (last?.role === "toolResult" && last.toolName === "send_message")
        return fauxAssistantMessage("parent waiting");
      return fauxAssistantMessage(fauxToolCall("write", { path: "later.txt", content: "child" }), {
        stopReason: "toolUse",
      });
    };
    let childId = "";
    const continuation: Parameters<typeof fakeModel>[0] = [
      () =>
        fauxAssistantMessage(
          fauxToolCall("send_message", { agent_id: childId, message: "write now" }),
          {
            stopReason: "toolUse",
          },
        ),
      continuedResponse,
      continuedResponse,
      fauxAssistantMessage("done"),
      fauxAssistantMessage("done"),
    ];
    const parent = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage(
          fauxToolCall(toolName, {
            description: "Inspect",
            prompt: "inspect",
            run_in_background: false,
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("inspected"),
        fauxAssistantMessage("parent done"),
        ...(resume ? [] : continuation),
      ]),
      permissionMode: "full-access",
    });
    await runRequest(parent, "inspect first", {
      onEvent(event) {
        events.push(event);
      },
    });
    const event = events.find((event) => event.type === "subagent_event");
    if (event?.type !== "subagent_event") throw new Error("Missing child event");
    childId = event.agentId;
    if (resume) await parent.close();
    const session = resume
      ? await createSession({
          ...dirs,
          ...fakeModel(continuation),
          resumeId: parent.id,
          permissionMode: "full-access",
        })
      : parent;
    await runRequest(session, "ask the child to write");
    expect(await Bun.file(join(dirs.cwd, "later.txt")).text()).toBe("child");
    const checkpoints = session.checkpoints();
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]!.files).toEqual([]);
    expect(checkpoints[1]).toMatchObject({
      preview: "ask the child to write",
      files: [{ path: await realpath(join(dirs.cwd, "later.txt")), backup: expect.any(String) }],
    });
    await session.rewind(checkpoints[1]!.promptEntryId, { code: true, conversation: false });
    expect(await Bun.file(join(dirs.cwd, "later.txt")).text()).toBe("original");
  },
);

test("concurrent parent and child writes share one original file record", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "shared.txt"), "original");
  const release = Promise.withResolvers<void>();
  let allowed = 0;
  const write = () =>
    fauxAssistantMessage(fauxToolCall("write", { path: "shared.txt", content: "changed" }), {
      stopReason: "toolUse",
    });
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall("subagent", { description: "First", prompt: "first write" }),
          fauxToolCall("subagent_fork", { description: "Second", prompt: "second write" }),
        ],
        { stopReason: "toolUse" },
      ),
      write,
      write,
      write,
      fauxAssistantMessage("done"),
      fauxAssistantMessage("done"),
      fauxAssistantMessage("done"),
      fauxAssistantMessage("done"),
      fauxAssistantMessage("done"),
    ]),
    permissionMode: "full-access",
    async onToolCallAllowed(call) {
      if (call.toolName !== "write") return;
      allowed++;
      if (allowed === 3) release.resolve();
      await release.promise;
    },
  });
  await runRequest(session, "write together");
  expect(allowed).toBe(3);
  const checkpoint = session.checkpoints()[0]!;
  expect(checkpoint.files).toEqual([
    { path: await realpath(join(dirs.cwd, "shared.txt")), backup: expect.any(String) },
  ]);
  await session.rewind(checkpoint.promptEntryId, { code: true, conversation: false });
  expect(await Bun.file(join(dirs.cwd, "shared.txt")).text()).toBe("original");
});
