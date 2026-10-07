import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Value } from "typebox/value";
import type { Static, TSchema } from "typebox";
import {
  ToolCallViewSchema,
  ToolResultViewSchema,
  type ToolCallView,
  type ToolResultView,
} from "@rukie/shared";

/** Pure presentation reads only arguments and persisted result facts. Failures never affect execution. */
export type PresentedTool<T extends TSchema = TSchema, D = unknown> = AgentTool<T, D> & {
  presentCall?(args: Static<T>): ToolCallView | undefined;
  presentResult?(args: Static<T>, result: string, details: unknown): ToolResultView | undefined;
};
export function presentCall(tool: AgentTool | undefined, args: unknown): ToolCallView | undefined {
  try {
    if (!tool || !Value.Check(tool.parameters, args)) return;
    const view = (tool as PresentedTool).presentCall?.(args);
    return view && Value.Check(ToolCallViewSchema, view) ? view : undefined;
  } catch {
    return;
  }
}
export function presentResult(
  tool: AgentTool | undefined,
  args: unknown,
  result: { content: { type: string; text?: string }[]; details?: unknown },
): ToolResultView | undefined {
  try {
    if (!tool || !Value.Check(tool.parameters, args)) return;
    const text = result.content
      .flatMap((item) => (item.type === "text" ? [item.text ?? ""] : []))
      .join("\n");
    const view = (tool as PresentedTool).presentResult?.(args, text, result.details);
    return view && Value.Check(ToolResultViewSchema, view) ? view : undefined;
  } catch {
    return;
  }
}
