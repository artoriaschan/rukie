import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  hook,
  ToolTask,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  createPermissionBatch,
  type PermissionAskRequest,
} from "../../../src/permissions/index.ts";
import { tempDirs } from "../../helpers/temp-dirs.ts";
import { fakeModel } from "../../helpers/fake-model.ts";
import { expect, test } from "bun:test";
import { createConversationRuntime } from "../../../src/session/conversation/index.ts";

test("a Conversation owns its stop state and can begin another Run", () => {
  const root = createConversationRuntime({
    isClosed: () => false,
    lifetime: new AbortController().signal,
  });
  const child = createConversationRuntime({
    isClosed: () => false,
    lifetime: new AbortController().signal,
    origin: { agentId: "child", description: "Reader" },
  });
  child.stop("Review required");
  expect(child.stopped).toBe(true);
  expect(child.stopReason).toBe("Review required");
  expect(root.stopped).toBe(false);
  child.reset();
  expect(child.stopped).toBe(false);
  expect(child.stopReason).toBeUndefined();
});

test.each(["allow", "deny"] as const)(
  "a child authorizes rewritten input before executing and applies its result hook: %s",
  async (decision) => {
    const dirs = await tempDirs();
    const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("effect", { text: "original" }), { stopReason: "toolUse" }),
      (request) => {
        expect(request.messages.findLast((message) => message.role === "toolResult")).toMatchObject(
          decision === "allow"
            ? { content: [{ type: "text", text: "after hook" }] }
            : { isError: true },
        );
        return fauxAssistantMessage("done");
      },
    ]);
    const registry = createRegistry();
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: fake.models, registry },
      context,
    );
    const batch = createPermissionBatch(harness);
    const runtime = createConversationRuntime({
      lifetime: new AbortController().signal,
      isClosed: () => false,
      origin: { agentId: "child", description: "Reader" },
    });
    const hookRuntime = runtime.createHooks({
      cwd: dirs.cwd,
      homeDir: dirs.homeDir,
      projectDir: dirs.cwd,
      model: { models: fake.models, getModel: async () => fake.model },
      onWarning: (message) => {
        throw new Error(message);
      },
      onEvent: () => {},
      settings: {
        PreToolUse: [
          {
            hooks: [
              {
                type: "command",
                command:
                  'printf \'%s\' \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"text":"rewritten"}}}\'',
              },
            ],
          },
        ],
        PostToolUse: [
          {
            hooks: [
              {
                type: "command",
                command:
                  'printf \'%s\' \'{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":[{"type":"text","text":"after hook"}]}}\'',
              },
            ],
          },
        ],
      },
    });
    const effects: string[] = [];
    const asks: PermissionAskRequest[] = [];
    let tools: ToolRegistration[] = [];
    runtime.configurePolicy({
      hooks: hookRuntime,
      input: (extra = {}) => ({
        session_id: "child",
        transcript_path: "",
        cwd: dirs.cwd,
        permission_mode: "ask",
        agent_id: "child",
        agent_type: "reader",
        ...extra,
      }),
      apply: async () => {},
      batch,
      permission: {
        ...dirs,
        rules: [],
        getMode: () => "ask",
        getTools: () => tools,
        getMessages: async () => [],
        getProjectInstructions: () => [],
        getReviewModel: () => fake.model,
        models: fake.models,
        onEvent: () => {},
        onPermissionAsk: async (request) => {
          asks.push(request);
          expect(effects).toEqual([]);
          return decision;
        },
      },
    });
    tools = runtime.wrapTools([
      {
        name: "effect",
        description: "Effect",
        parameters: Type.Object({ text: Type.String() }),
        execute: async (args) => {
          if (
            !args ||
            typeof args !== "object" ||
            !("text" in args) ||
            typeof args.text !== "string"
          )
            throw new Error("Invalid effect input");
          effects.push(args.text);
          return { content: [{ type: "text", text: args.text }] };
        },
      },
    ]);
    const extension = {
      name: "runtime",
      tools,
      hooks: [hook(ToolTask, { beforeTool: runtime.beforeTool, afterTool: runtime.afterTool })],
    };
    registry.install(extension);
    try {
      const conversation = await harness.root(context, {
        agent: {
          model: { provider: fake.model.provider, modelId: fake.model.id },
          extensions: [extension],
          tools,
        },
      });
      await (await conversation.submit({ type: "input", content: "work" }, context)).wait(context);
      await conversation.waitForIdle(context);
      expect(effects).toEqual(decision === "allow" ? ["rewritten"] : []);
      expect(asks[0]).toMatchObject({
        args: { text: "rewritten" },
        origin: { agentId: "child", description: "Reader" },
      });
    } finally {
      hookRuntime.dispose();
      await harness.close(context);
      batch.close();
      await dirs.cleanup();
    }
  },
);
