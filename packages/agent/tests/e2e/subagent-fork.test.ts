import { runRequest } from "../helpers/crashed-subagents.ts";
import { withAuxiliaryRequests, modelStream, withModelStream } from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each(["ask", "auto-review", "full-access"] as const)(
  "fork without a completed parent Turn starts with only its delegated prompt in %s mode",
  async (permissionMode) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent_fork", {
          description: "Fork",
          prompt: "child prompt",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const conversation = context.messages.filter((message) =>
          ["assistant", "toolResult"].includes(message.role),
        );
        expect(conversation).toEqual([]);
        expect(JSON.stringify(context.messages)).toContain("child prompt");
        expect(JSON.stringify(context.messages)).not.toContain("current parent prompt");
        return fauxAssistantMessage("child conclusion");
      },
      (context) => {
        expect(context.messages.at(-1)).toMatchObject({
          role: "toolResult",
          isError: false,
          content: [{ type: "text", text: "child conclusion" }],
        });
        return fauxAssistantMessage("parent conclusion");
      },
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({ ...dirs, ...fake, permissionMode });
    expect(
      (
        await runRequest(session, "current parent prompt", {
          onEvent: (event) => {
            events.push(event);
          },
        })
      ).text,
    ).toBe("parent conclusion");
    expect(events.filter((event) => event.type === "subagent_event").length).toBeGreaterThan(0);
    expect(
      events
        .filter((event) => event.type === "subagent_event")
        .every((event) => event.subagentType === "fork"),
    ).toBe(true);
  },
);

test.each(["same Run", "previous Run"])(
  "fork copies completed Turns from the %s into independent Transcript entries",
  async (history) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        [
          { type: "text", text: "completed parent thought" },
          fauxToolCall("todo_write", { todos: [] }),
        ],
        { stopReason: "toolUse" },
      ),
      ...(history === "previous Run" ? [fauxAssistantMessage("previous Run conclusion")] : []),
      fauxAssistantMessage(
        [
          { type: "text", text: "unfinished fork thought" },
          fauxToolCall("subagent_fork", {
            description: "Fork",
            prompt: "fork prompt",
            run_in_background: false,
          }),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        const raw = JSON.stringify(context.messages);
        expect(raw).toContain("completed parent prompt");
        expect(raw).toContain("completed parent thought");
        expect(
          context.messages.some(
            (message) => message.role === "toolResult" && message.toolName === "todo_write",
          ),
        ).toBe(true);
        expect(raw).not.toContain("unfinished fork thought");
        expect(
          context.messages
            .filter((message) => message.role === "assistant")
            .flatMap((message) => message.content)
            .filter((block) => block.type === "toolCall")
            .map((block) => block.name),
        ).not.toContain("subagent_fork");
        expect(raw).not.toContain("current parent prompt");
        if (history === "previous Run") expect(raw).toContain("previous Run conclusion");
        return fauxAssistantMessage("fork conclusion");
      },
      (context) => {
        expect(context.messages.at(-1)).toMatchObject({
          role: "toolResult",
          isError: false,
          content: [{ type: "text", text: "fork conclusion" }],
        });
        return fauxAssistantMessage("parent conclusion");
      },
    ]);
    fake.model.contextWindow = 100_000;
    const session = await createSession({ ...dirs, ...fake });
    const events: SessionEvent[] = [];
    if (history === "previous Run") await runRequest(session, "completed parent prompt");
    await runRequest(
      session,
      history === "previous Run" ? "current parent prompt" : "completed parent prompt",
      {
        onEvent(event) {
          events.push(event);
        },
      },
    );
    const childEvent = events.find((event) => event.type === "subagent_event");
    expect(childEvent?.type).toBe("subagent_event");
    if (childEvent?.type !== "subagent_event") throw new Error("Missing fork event");
    const snapshot = await session.readSubagent(childEvent.agentId);
    const messages = snapshot?.messages ?? [];
    expect(JSON.stringify(messages)).toContain("completed parent thought");
    expect(
      messages.some(
        (message) => message.role === "toolResult" && message.toolName === "todo_write",
      ),
    ).toBe(true);
    expect(JSON.stringify(messages)).not.toContain("unfinished fork thought");
    expect(JSON.stringify(messages)).toContain("fork conclusion");
    await session.close();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    try {
      expect((await resumed.readSubagent(childEvent.agentId))?.messages).toEqual(messages);
    } finally {
      await resumed.close();
    }
  },
);

test("fork inherits the parent model, system prompt and tools despite model settings and a custom fork type", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, ".rukie/agents/fork.md"),
    "---\nname: fork\ndescription: Custom fork\nmodel: missing/type\ntools: [read]\n---\nCustom fork instructions",
  );
  const fake = fakeModel([
    fauxAssistantMessage("completed"),
    fauxAssistantMessage(
      fauxToolCall("subagent_fork", {
        description: "Fork",
        prompt: "child prompt",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      const parent = getCurrentSystemMessage(fake.contexts[1]!.messages)!;
      const child = getCurrentSystemMessage(context.messages)!;
      expect(child.content).toEqual(parent.content);
      expect(JSON.stringify(child.content)).not.toContain("Custom fork instructions");
      const topLevelOnly = [
        "subagent",
        "subagent_fork",
        "send_message",
        "list_agents",
        "create_goal",
        "update_goal",
      ];
      const tools = child.toolsAdded!.map((tool) => tool.name);
      expect(tools).toEqual(
        parent.toolsAdded!.map((tool) => tool.name).filter((name) => !topLevelOnly.includes(name)),
      );
      expect(topLevelOnly.every((name) => !tools.includes(name))).toBe(true);
      expect(tools).toContain("write");
      return fauxAssistantMessage("child conclusion");
    },
    (context) => {
      expect(context.messages.at(-1)).toMatchObject({
        role: "toolResult",
        isError: false,
        content: [{ type: "text", text: "child conclusion" }],
      });
      return fauxAssistantMessage("parent conclusion");
    },
  ]);
  fake.model.contextWindow = 100_000;
  const models: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { subagentModel: "missing/settings", thinking: "low" },
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests((model, context, options) => {
        models.push(`${model.provider}/${model.id}`);
        expect(options?.reasoning).toBe("low");
        return modelStream(fake.models)(model, context, options);
      }),
    ),
  });
  await runRequest(session, "completed prompt");
  await runRequest(session, "fork now");
  expect(models).toEqual(
    Array.from({ length: 4 }, () => `${fake.model.provider}/${fake.model.id}`),
  );
  expect(fake.contexts).toHaveLength(4);
});
