import { afterEach, expect, test } from "bun:test";
import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentTools,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createSession as createSessionImpl, type Session } from "../../src/index.ts";
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
async function runRequest(session: Session, ...args: Parameters<Session["run"]>) {
  const result = await session.run(...args);
  await session.waitForRequest(result.requestId);
  return result;
}
const call = (name: string, args = {}) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

test("list_agents reports an empty directory and errors for unknown ids", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("list_agents"),
    (context) => {
      expect(
        structuredClone(context.messages.findLast((message) => message.role === "toolResult")),
      ).toMatchObject({
        role: "toolResult",
        isError: false,
        content: [{ type: "text", text: "(no subagents)" }],
      });
      return call("send_message", { agent_id: "unknown", message: "continue" });
    },
    (context) => {
      expect(
        structuredClone(context.messages.findLast((message) => message.role === "toolResult")),
      ).toMatchObject({
        role: "toolResult",
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("Unknown subagent") }],
      });
      return fauxAssistantMessage("done");
    },
  ]);
  expect((await (await createSession({ ...dirs, ...fake })).run("directory")).success).toBe(true);
});

test("idle children keep their own history and todos when send_message starts a background Run", async () => {
  dirs = await tempDirs();
  let id = "";
  const fake = fakeModel([
    call("subagent", {
      description: "Investigate",
      prompt: "first child prompt",
      run_in_background: false,
    }),
    call("todo_write", { todos: [{ content: "Child task", status: "in_progress" }] }),
    fauxAssistantMessage("first child answer"),
    (context) => {
      const result = context.messages.findLast((message) => message.role === "toolResult")!;
      if (result.role !== "toolResult") throw new Error("Expected child result");
      id = (result.details as { agentId: string }).agentId;
      return call("list_agents");
    },
    (context) => {
      expect(
        JSON.stringify(context.messages.findLast((message) => message.role === "toolResult")),
      ).toContain(`${id} [idle] — Investigate`);
      return call("send_message", { agent_id: id, message: "follow up" });
    },
    ...Array.from({ length: 3 }, () => (context: TranscriptContext) => {
      const text = JSON.stringify(context.messages);
      const child = !getCurrentTools(context.messages).some((tool) => tool.name === "subagent");
      if (child) {
        expect(text).toContain("first child answer");
        expect(text).toContain("Child task");
        expect(text).toContain("follow up");
        return fauxAssistantMessage("follow up answer");
      }
      if (
        context.messages.findLast((message) => message.role === "toolResult")?.role === "toolResult"
      )
        expect(
          JSON.stringify(context.messages.findLast((message) => message.role === "toolResult")),
        ).toContain(`delivered to ${id}`);
      return fauxAssistantMessage("parent done");
    }),
  ]);
  fake.model.contextWindow = 100_000;
  const session = await createSession({ ...dirs, ...fake });
  await runRequest(session, "delegate");
  expect(session.toolState("subagents")).toMatchObject([
    { id, description: "Investigate", type: "general-purpose" },
  ]);
  expect(session.toolState("todo")).toBeUndefined();
  expect(JSON.stringify(session.messages)).toContain(
    "finished. Its closing message:\nfollow up answer".replace("\n", "\\n"),
  );
});

test.each(["explore", "custom", "deleted", "fork"])(
  "parent resume restores idle %s and cold continuation preserves child history and configuration",
  async (type) => {
    dirs = await tempDirs();
    const path = `${dirs.cwd}/.rukie/agents/reader.md`;
    if (type === "custom" || type === "deleted")
      await Bun.write(
        path,
        "---\nname: reader\ndescription: Reader\ntools: [read, todo_write]\n---\nReader instructions",
      );
    let id = "";
    const first = fakeModel([
      fauxAssistantMessage("completed parent history"),
      call(type === "fork" ? "subagent_fork" : "subagent", {
        description: "Restore",
        prompt: "child original",
        subagent_type: type === "explore" ? "explore" : "reader",
        run_in_background: false,
      }),
      call("todo_write", { todos: [{ content: "Own todo", status: "pending" }] }),
      fauxAssistantMessage("child original answer"),
      (context) => {
        const result = context.messages.findLast((message) => message.role === "toolResult")!;
        if (result.role !== "toolResult") throw new Error("Expected tool result");
        id = (result.details as { agentId: string }).agentId;
        return fauxAssistantMessage("parent done");
      },
    ]);
    first.model.contextWindow = 100_000;
    const parent = await createSession({ ...dirs, ...first });
    await runRequest(parent, "parent original");
    await runRequest(parent, "delegate");
    // Later parent work must never be copied into an existing fork.
    const later = fakeModel([fauxAssistantMessage("later parent history")]);
    await parent.close();
    const laterSession = await createSession({ ...dirs, ...later, resumeId: parent.id });
    await runRequest(laterSession, "later parent prompt");
    await laterSession.close();
    if (type === "deleted") await Bun.file(path).delete();
    if (type === "fork")
      await Bun.write(
        path,
        "---\nname: fork\ndescription: Wrong fork\nmodel: missing/model\ntools: [read]\n---\nWrong fork prompt",
      );
    const warnings: string[] = [];
    const reply = (context: TranscriptContext) => {
      const text = JSON.stringify(context.messages);
      if (!getCurrentTools(context.messages).some((tool) => tool.name === "subagent")) {
        expect(text).toContain("child original answer");
        expect(text).toContain("Own todo");
        expect(text).toContain("continue restored child");
        const system = getCurrentSystemMessage(context.messages)!;
        if (system.role !== "system") throw new Error("Expected system");
        const tools = getCurrentTools(context.messages).map((tool) => tool.name);
        expect(tools).not.toContain("send_message");
        if (type === "custom") {
          expect(tools).toEqual(["read", "todo_write"]);
          expect(text).toContain("Reader instructions");
        } else if (type === "explore") expect(tools).not.toContain("write");
        else expect(tools).toContain("write");
        if (type === "fork") {
          expect(
            context.messages.filter(
              (message) =>
                message.role === "assistant" &&
                JSON.stringify(message.content).includes("completed parent history"),
            ),
          ).toHaveLength(1);
          expect(text).not.toContain("later parent history");
          expect(JSON.stringify(system.content)).not.toContain("You are a subagent");
          expect(text).not.toContain("Wrong fork prompt");
        }
        return fauxAssistantMessage("restored conclusion");
      }
      return fauxAssistantMessage("parent restored done");
    };
    const resumedFake = fakeModel([
      call("list_agents"),
      (context) => {
        expect(
          JSON.stringify(context.messages.findLast((message) => message.role === "toolResult")),
        ).toContain(`${id} [idle] — Restore`);
        return call("send_message", { agent_id: id, message: "continue restored child" });
      },
      ...Array.from({ length: 3 }, () => reply),
    ]);
    resumedFake.model.contextWindow = 100_000;
    const resumed = await createSession({
      ...dirs,
      ...resumedFake,
      resumeId: parent.id,
      onWarning: (warning) => warnings.push(warning),
    });
    expect(resumed.toolState("subagents")).toMatchObject([
      {
        id,
        description: "Restore",
        type: type === "fork" ? "fork" : type === "explore" ? "explore" : "reader",
      },
    ]);
    expect(resumed.toolState("todo")).toBeUndefined();
    expect((await runRequest(resumed, "resume")).success).toBe(true);
    expect(warnings.some((warning) => warning.includes("falling back to general-purpose"))).toBe(
      type === "deleted",
    );
    expect(JSON.stringify(resumed.messages)).toContain("restored conclusion");
  },
);

test("send_message steers the active child before its next model request and list_agents reports running", async () => {
  dirs = await tempDirs();
  const release = Promise.withResolvers<void>();
  let id = "";
  let childCalls = 0;
  const childStarted = Promise.withResolvers<void>();
  const reply = async (context: TranscriptContext) => {
    if (!getCurrentTools(context.messages).some((tool) => tool.name === "subagent")) {
      if (++childCalls === 1) {
        childStarted.resolve();
        await release.promise;
        return call("todo_write", { todos: [] });
      }
      expect(
        context.messages.some(
          (message) =>
            message.role === "user" &&
            JSON.stringify(message.content).includes("adjust investigation"),
        ),
      ).toBe(true);
      return fauxAssistantMessage("adjusted conclusion");
    }
    const result = context.messages.findLast((message) => message.role === "toolResult")!;
    if (result.role === "toolResult" && result.toolName === "subagent") {
      await childStarted.promise;
      id = (result.details as { agentId: string }).agentId;
      return call("list_agents");
    }
    if (result.role === "toolResult" && result.toolName === "list_agents") {
      expect(JSON.stringify(result)).toContain(`${id} [running] — Active`);
      return call("send_message", { agent_id: id, message: "adjust investigation" });
    }
    if (result.role === "toolResult") {
      expect(JSON.stringify(result)).toContain(`delivered to ${id}`);
      expect(result.details).toEqual({});
      release.resolve();
    }
    return fauxAssistantMessage("parent done");
  };
  const fake = fakeModel([
    call("subagent", { description: "Active", prompt: "first" }),
    ...Array.from({ length: 8 }, () => reply),
  ]);
  fake.model.contextWindow = 100_000;
  const session = await createSession({ ...dirs, ...fake });
  try {
    await runRequest(session, "delegate");
  } finally {
    release.resolve();
  }
  expect(childCalls).toBe(2);
  expect(JSON.stringify(session.messages)).toContain("adjusted conclusion");
});

test("send_message cannot address a child belonging to another parent session", async () => {
  dirs = await tempDirs();
  let id = "";
  const first = fakeModel([
    call("subagent", { description: "Owned", prompt: "child", run_in_background: false }),
    fauxAssistantMessage("child done"),
    (context) => {
      const result = context.messages.findLast((message) => message.role === "toolResult")!;
      if (result.role === "toolResult") id = (result.details as { agentId: string }).agentId;
      return fauxAssistantMessage("done");
    },
  ]);
  await (await createSession({ ...dirs, ...first })).run("delegate");
  const other = fakeModel([
    call("send_message", { agent_id: id, message: "cross parent" }),
    (context) => {
      expect(
        structuredClone(context.messages.findLast((message) => message.role === "toolResult")),
      ).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining(`Unknown subagent: ${id}`) }],
      });
      return fauxAssistantMessage("done");
    },
  ]);
  expect((await (await createSession({ ...dirs, ...other })).run("send")).success).toBe(true);
});

test("an idle continuation is rejected at eight running children while active steering remains available", async () => {
  dirs = await tempDirs();
  const release = Promise.withResolvers<void>();
  let idleId = "";
  let activeId = "";
  let started = 0;
  const allStarted = Promise.withResolvers<void>();
  const response = async (context: TranscriptContext) => {
    const parent = getCurrentTools(context.messages).some((tool) => tool.name === "subagent");
    if (!parent) {
      if (++started === 8) allStarted.resolve();
      await release.promise;
      return fauxAssistantMessage("active done");
    }
    const last = context.messages.findLast((message) => message.role === "toolResult")!;
    if (last.role === "toolResult" && last.toolName === "subagent") {
      await allStarted.promise;
      const results = context.messages.filter(
        (message) => message.role === "toolResult" && message.toolName === "subagent",
      );
      const activeResult = results.at(-1)!;
      if (activeResult.role !== "toolResult") throw new Error("Expected tool result");
      activeId = (activeResult.details as { agentId: string }).agentId;
      return call("send_message", { agent_id: idleId, message: "should reject" });
    }
    if (last.role === "toolResult" && last.toolName === "send_message" && last.isError) {
      expect(JSON.stringify(last)).toContain("At most 8");
      return call("send_message", { agent_id: activeId, message: "active still allowed" });
    }
    if (last.role === "toolResult" && last.toolName === "send_message") {
      expect(JSON.stringify(last)).toContain(`delivered to ${activeId}`);
      release.resolve();
    }
    return fauxAssistantMessage("parent done");
  };
  const fake = fakeModel([
    call("subagent", { description: "Idle", prompt: "idle", run_in_background: false }),
    fauxAssistantMessage("idle done"),
    (context) => {
      const result = context.messages.findLast((message) => message.role === "toolResult")!;
      if (result.role === "toolResult") idleId = (result.details as { agentId: string }).agentId;
      return fauxAssistantMessage(
        Array.from({ length: 8 }, (_, index) =>
          fauxToolCall("subagent", { description: `Active ${index}`, prompt: "active" }),
        ),
        { stopReason: "toolUse" },
      );
    },
    ...Array.from({ length: 24 }, () => response),
  ]);
  fake.model.contextWindow = 100_000;
  const session = await createSession({ ...dirs, ...fake });
  expect((await runRequest(session, "delegate")).success).toBe(true);
  expect(session.toolState("subagents")).toHaveLength(9);
});

test("parallel messages to an idle cold child start one Run and steer the following message", async () => {
  dirs = await tempDirs();
  let id = "";
  const original = fakeModel([
    call("subagent", { description: "One", prompt: "original", run_in_background: false }),
    fauxAssistantMessage("original done"),
    (context) => {
      const result = context.messages.findLast((message) => message.role === "toolResult")!;
      if (result.role === "toolResult") id = (result.details as { agentId: string }).agentId;
      return fauxAssistantMessage("done");
    },
  ]);
  const parent = await createSession({ ...dirs, ...original });
  await runRequest(parent, "delegate");
  const release = Promise.withResolvers<void>();
  let calls = 0;
  let starts = 0;
  const response = async (context: TranscriptContext) => {
    if (!getCurrentTools(context.messages).some((tool) => tool.name === "subagent")) {
      if (++calls === 1) {
        await release.promise;
        return call("todo_write", { todos: [] });
      }
      expect(JSON.stringify(context.messages)).toContain("second instruction");
      return fauxAssistantMessage("combined done");
    }
    const results = context.messages.filter(
      (message) => message.role === "toolResult" && message.toolName === "send_message",
    );
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.role === "toolResult" && !result.isError)).toBe(true);
    release.resolve();
    return fauxAssistantMessage("parent done");
  };
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("send_message", { agent_id: id, message: "first instruction" }),
        fauxToolCall("send_message", { agent_id: id, message: "second instruction" }),
      ],
      { stopReason: "toolUse" },
    ),
    ...Array.from({ length: 8 }, () => response),
  ]);
  fake.model.contextWindow = 100_000;
  await parent.close();
  const resumed = await createSession({ ...dirs, ...fake, resumeId: parent.id });
  await runRequest(resumed, "continue", {
    onEvent(event) {
      if (event.type === "subagent_event" && event.event.type === "run_start") starts++;
    },
  });
  expect({ starts, calls }).toEqual({ starts: 1, calls: 2 });
  expect(JSON.stringify(resumed.messages)).toContain("combined done");
});
