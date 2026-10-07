import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { PresentedTool } from "../presentation.ts";
import { Type } from "typebox";
import type {
  createSubagentController,
  SubagentDelegationFact,
  SubagentSendFact,
} from "./controller.ts";

const delegateParameters = Type.Object({
  description: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  subagent_type: Type.Optional(Type.String()),
  run_in_background: Type.Optional(Type.Boolean()),
});
const forkParameters = Type.Object({
  description: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  run_in_background: Type.Optional(Type.Boolean()),
});
const sendParameters = Type.Object({ agent_id: Type.String(), message: Type.String() });

type DelegationDetails = { agentId: string; childSessionId: string };

/** Renders one delegation's execution facts as the model-visible tool result. */
function delegationResult(fact: SubagentDelegationFact): AgentToolResult<DelegationDetails> {
  const details = { agentId: fact.agentId, childSessionId: fact.childSessionId };
  if (fact.kind === "completed")
    return {
      content: [{ type: "text", text: fact.result.text || fact.result.error || "" }],
      details,
      isError: !fact.result.success,
    };
  return {
    content: [
      {
        type: "text",
        text: fact.reused ? `delivered to ${fact.agentId}` : `started subagent ${fact.agentId}`,
      },
    ],
    details,
  };
}

function sendResult(fact: SubagentSendFact): AgentToolResult<object> {
  if (fact.kind === "steered")
    return { content: [{ type: "text", text: `delivered to ${fact.agentId}` }], details: {} };
  return delegationResult(fact);
}

/** The four Subagent model tools; the controller owns every execution fact they render. */
export function createSubagentTools(subagents: ReturnType<typeof createSubagentController>) {
  const delegate: PresentedTool<typeof delegateParameters> = {
    name: "subagent",
    presentCall: (args) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.subagent",
      rawInput: args,
    }),
    presentResult: (_args, text) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.subagent",
      text,
    }),
    label: "Subagent",
    // Discovery refreshes the available types per Run, so the declaration reads them now.
    get description() {
      const available = subagents.types();
      if (!available.length)
        return "Delegate a prompt to a general-purpose subagent. Runs in the background by default; its closing message is delivered when it finishes.";
      return (
        "Delegate a prompt to a subagent. Runs in the background by default; its closing message is delivered when it finishes. Available types:\n" +
        available.map((type) => `${type.name}: ${type.description}`).join("\n")
      );
    },
    parameters: delegateParameters,
    async execute(
      _id,
      { description, prompt, subagent_type = "general-purpose", run_in_background = true },
    ) {
      return delegationResult(
        await subagents.delegate({
          type: subagent_type,
          description,
          prompt,
          background: run_in_background,
        }),
      );
    },
  };
  const fork: PresentedTool<typeof forkParameters> = {
    name: "subagent_fork",
    presentCall: (args) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.subagent_fork",
      rawInput: args,
    }),
    presentResult: (_args, text) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.subagent_fork",
      text,
    }),
    label: "Fork Subagent",
    description:
      "Delegate a prompt to a fork of this session through its last completed Turn, excluding the current Turn. Inherits the parent model and tools; runs in the background by default.",
    parameters: forkParameters,
    async execute(_id, { description, prompt, run_in_background = true }) {
      return delegationResult(
        await subagents.fork({ description, prompt, background: run_in_background }),
      );
    },
  };
  const send: PresentedTool<typeof sendParameters> = {
    name: "send_message",
    presentCall: (args) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.send_message",
      rawInput: args,
    }),
    presentResult: (_args, text) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.send_message",
      text,
    }),
    label: "Send Message",
    description:
      "Send instructions to one of this session's subagents. Steers an active Run or starts a new background Run for an idle child.",
    parameters: sendParameters,
    async execute(_id, { agent_id, message }) {
      return sendResult(await subagents.send(agent_id, message));
    },
  };
  const list: PresentedTool = {
    name: "list_agents",
    presentCall: (args) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.list_agents",
      rawInput: args,
    }),
    presentResult: (_args, text) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.list_agents",
      text,
    }),
    label: "List Agents",
    description: "List this session's subagents, their Run status and descriptions.",
    parameters: Type.Object({}),
    async execute() {
      const text = subagents
        .list()
        .map((child) => `${child.id} [${child.active ? "running" : "idle"}] — ${child.description}`)
        .join("\n");
      return { content: [{ type: "text", text: text || "(no subagents)" }], details: {} };
    },
  };
  return { delegate, fork, send, list };
}
