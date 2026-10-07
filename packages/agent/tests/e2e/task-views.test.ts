import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

const cases: { name: string; args: Parameters<typeof fauxToolCall>[1] }[] = [
  { name: "todo_write", args: { todos: [{ content: "task", status: "pending" }] } },
  {
    name: "ask_user_question",
    args: {
      questions: [
        {
          question: "Choose",
          header: "Choice",
          options: [
            { label: "A", description: "A" },
            { label: "B", description: "B" },
          ],
        },
      ],
    },
  },
  { name: "enter_plan_mode", args: {} },
  { name: "exit_plan_mode", args: { plan: "Plan" } },
  { name: "subagent", args: { description: "Child", prompt: "Inspect", run_in_background: false } },
  {
    name: "subagent_fork",
    args: { description: "Fork", prompt: "Inspect", run_in_background: false },
  },
  { name: "send_message", args: { agent_id: "missing-child", message: "Continue" } },
  { name: "list_agents", args: {} },
];
test.each(cases)(
  "$name carries task classification in public events and Session Resume",
  async ({ name, args }) => {
    const dirs = await tempDirs();
    const replies = [
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
      fauxAssistantMessage("done"),
    ];
    const options = {
      ...dirs,
      permissionMode: "full-access" as const,
      onQuestion: async () => "declined" as const,
      onPlanReview: async () => ({ kind: "approve" as const }),
    };
    const session = await createSession({ ...options, ...fakeModel(replies) });
    let resumed: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      const events: SessionEvent[] = [];
      await session.run("inspect", {
        onEvent: (event) => {
          events.push(event);
        },
      });
      for (const type of ["tool_execution_start", "tool_execution_end"])
        expect(
          events.find(
            (event) => event.type === type && "toolName" in event && event.toolName === name,
          ),
        ).toMatchObject({ view: { kind: "task", displayKey: `tool.${name}` } });
      await session.dispose();
      resumed = await createSession({ ...options, ...fakeModel([]), resumeId: session.id });
      expect(
        resumed.messages.find(
          (message) => message.role === "toolResult" && message.toolName === name,
        ),
      ).toMatchObject({ view: { kind: "task", displayKey: `tool.${name}` } });
    } finally {
      await resumed?.dispose();
      await session.dispose();
      await dirs.cleanup();
    }
  },
);
