import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

const parameters = Type.Object({});

export function createEnterPlanModeTool(plan: {
  getActive(): boolean;
  setMode(on: boolean): Promise<void>;
}): AgentTool<typeof parameters> {
  return {
    name: "enter_plan_mode",
    label: "Enter Plan Mode",
    description:
      "Request permission to enter Plan Mode before exploring and planning a larger task.",
    parameters,
    async execute(_toolCallId, _params, signal) {
      signal?.throwIfAborted();
      if (plan.getActive()) throw new Error("already in plan mode");
      await plan.setMode(true);
      return {
        content: [
          {
            type: "text",
            text: "Entered Plan Mode. Explore the code and context first, then submit a markdown plan with exit_plan_mode for user review.",
          },
        ],
        details: {},
      };
    },
  };
}
