import type { PresentedTool } from "./presentation.ts";
import type { PreflightTool } from "./preflight.ts";
import { Type, type Static } from "typebox";
import {
  requestInteraction,
  type OnInteractionStart,
  type InteractionIdentity,
} from "../interaction/index.ts";

const parameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      question: Type.String(),
      header: Type.String(),
      multiSelect: Type.Optional(Type.Boolean({ default: false })),
      options: Type.Array(Type.Object({ label: Type.String(), description: Type.String() }), {
        minItems: 2,
        maxItems: 4,
      }),
    }),
    { minItems: 1, maxItems: 4 },
  ),
});

export type Question = Static<typeof parameters>["questions"][number];
export interface QuestionRequest {
  identity: InteractionIdentity;
  toolCallId: string;
  questions: Question[];
  signal: AbortSignal;
  origin?: { agentId: string; description: string };
}
export type QuestionReply = { answers: { selected: string[]; custom?: string }[] } | "declined";
export type OnQuestion = (request: QuestionRequest) => Promise<QuestionReply>;

export function createQuestionTool(
  onQuestion: OnQuestion,
  onInteractionStart?: OnInteractionStart,
): PresentedTool<typeof parameters> & PreflightTool<typeof parameters> {
  const replies = new Map<number, QuestionReply>();
  return {
    name: "ask_user_question",
    presentCall: (args) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.ask_user_question",
      rawInput: args,
    }),
    presentResult: (_args, text) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.ask_user_question",
      text,
    }),
    description:
      "Ask the user 1–4 questions with 2–4 choices each. The frontend automatically adds an Other choice for free text; do not add it yourself.",
    parameters,
    async preflight({ questions }, api, context, toolCallId, identity) {
      const signal = context.abortSignal ?? new AbortController().signal;
      const reply = await requestInteraction<QuestionRequest, QuestionReply | undefined>(
        { toolCallId, questions, signal, identity },
        onQuestion,
        undefined,
        {
          notify: onInteractionStart,
          notification: {
            notification_type: "question",
            title: "Question from agent",
            message: questions.map(({ question }) => question).join("\n"),
          },
        },
      );
      signal.throwIfAborted();
      if (reply === undefined) throw new Error("Question cancelled.");
      replies.set(Number(api.taskId), reply);
      signal.addEventListener("abort", () => replies.delete(Number(api.taskId)), { once: true });
    },
    async execute({ questions }, api, context) {
      context.abortSignal?.throwIfAborted();
      const reply = replies.get(Number(api.taskId));
      replies.delete(Number(api.taskId));
      if (reply === undefined) throw new Error("Question has no current frontend reply.");
      const text =
        reply === "declined"
          ? "The user declined to answer. Proceed with your best judgment or stop and wait for instructions."
          : questions
              .map(({ question }, index) => {
                const answer = reply.answers[index]!;
                const selected = answer.selected.join(", ");
                return `"${question}" → ${selected}${answer.custom ? `${selected ? "; " : ""}${answer.custom}` : ""}`;
              })
              .join("\n");
      return { content: [{ type: "text", text }], details: {} };
    },
  };
}
