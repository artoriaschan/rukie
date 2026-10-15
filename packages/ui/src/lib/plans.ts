import { fromMarkdown } from "mdast-util-from-markdown";
import type { RootContent } from "mdast";
import type { TranscriptState } from "./transcript";
import { presentationCallId } from "./transcript";

export function planTitle(plan: string): string {
  const text = (node: RootContent): string =>
    "value" in node
      ? node.value
      : "alt" in node
        ? (node.alt ?? "")
        : "children" in node
          ? node.children.map(text).join("")
          : "";
  const heading = fromMarkdown(plan).children.find((node) => node.type === "heading");
  return heading ? text(heading) : (plan.split("\n")[0] ?? "").trim();
}

export interface PlanSubmission {
  /** Transcript occurrence disambiguates provider call IDs reused across submissions. */
  id: string;
  toolId: string;
  title: string;
  plan: string;
  outcome?: "approve" | "revise" | "takeover";
}
export function planSubmissions(state: TranscriptState): PlanSubmission[] {
  const plans: PlanSubmission[] = [];
  const occurrences = new Map<string, number>();
  for (const message of [...state.committed, ...(state.partial ? [state.partial] : [])]) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall" || block.name !== "exit_plan_mode") continue;
      if (
        message === state.partial &&
        state.committed.some(
          (entry) =>
            entry.role === "assistant" &&
            entry.timestamp === message.timestamp &&
            entry.content.some((item) => item.type === "toolCall" && item.id === block.id),
        )
      )
        continue;
      const args: unknown = block.arguments;
      if (
        typeof args !== "object" ||
        args === null ||
        !("plan" in args) ||
        typeof args.plan !== "string"
      )
        continue;
      const occurrence = (occurrences.get(block.id) ?? 0) + 1;
      occurrences.set(block.id, occurrence);
      plans.push({
        id: `plan:${block.id}:${occurrence}`,
        toolId: presentationCallId(message, block.id),
        title: planTitle(args.plan),
        plan: args.plan,
        outcome: state.tools[presentationCallId(message, block.id)]?.planOutcome,
      });
    }
  }
  return plans;
}
export function latestPlan(state: TranscriptState): PlanSubmission | undefined {
  return planSubmissions(state).at(-1);
}
