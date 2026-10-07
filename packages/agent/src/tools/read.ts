import type { AgentTool, createReadTool } from "@earendil-works/pi-agent-core";
import type { PresentedTool } from "./presentation.ts";

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
    presentResult: (args, content) => ({
      card: "read",
      kind: "read",
      displayKey: "tool.read",
      path: args.path,
      offset: args.offset,
      content,
    }),
  };
}
