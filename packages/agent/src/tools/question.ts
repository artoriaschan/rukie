import type { PresentedTool } from "./presentation.ts";
import { Type, type Static } from "typebox";
import { requestInteraction, type OnInteractionStart } from "../interaction/index.ts";

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
): PresentedTool<typeof parameters> {
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
    label: "Ask user question",
    description:
      "Ask the user 1–4 questions with 2–4 choices each. The frontend automatically adds an Other choice for free text; do not add it yourself.",
    parameters,
    async execute(toolCallId, { questions }, signal = new AbortController().signal) {
      const reply = await requestInteraction<QuestionRequest, QuestionReply | undefined>(
        { toolCallId, questions, signal },
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
