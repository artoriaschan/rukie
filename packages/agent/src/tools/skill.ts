import { formatSkillInvocation, type AgentTool, type Skill } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

const schema = Type.Object({ name: Type.String({ description: "Name of the skill to load." }) });

export function createSkillTool(
  getSkill: (name: string) => Skill | undefined,
): AgentTool<typeof schema> {
  return {
    name: "skill",
    label: "skill",
    description: "Load a skill's full instructions by name from the available skills list.",
    parameters: schema,
    async execute(_id, { name }, signal) {
      signal?.throwIfAborted();
      const skill = getSkill(name);
      if (!skill) throw new Error(`Skill not found: ${name}`);
      return {
        content: [{ type: "text", text: formatSkillInvocation(skill) }],
        details: undefined,
      };
    },
  };
}
