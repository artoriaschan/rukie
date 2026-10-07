import type { AgentTool, createReadTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { PresentedTool } from "./presentation.ts";

const truncationDetails = Type.Object({
  truncation: Type.Object({
    truncated: Type.Boolean(),
    outputLines: Type.Number(),
    firstLineExceedsLimit: Type.Boolean(),
  }),
});

type ReadParameters = ReturnType<typeof createReadTool>["parameters"];

/** Keep pi's read execution and image attachments; presentation needs no second file read. */
export function withReadView<D>(
  tool: AgentTool<ReadParameters, D>,
): PresentedTool<ReadParameters, D> {
  return {
    ...tool,
    presentCall: (args) => ({
      card: "generic",
      kind: "read",
      displayKey: "tool.read",
      title: args.path,
    }),
    presentResult: (args, content, details) => ({
      card: "read",
      kind: "read",
      displayKey: "tool.read",
      path: args.path,
      offset: args.offset,
      content,
      ...(Value.Check(truncationDetails, details) && details.truncation.truncated
        ? {
            outputUnavailable: true,
            ...(!details.truncation.firstLineExceedsLimit
              ? { nextOffset: (args.offset ?? 1) + details.truncation.outputLines }
              : {}),
          }
        : {}),
    }),
  };
}
