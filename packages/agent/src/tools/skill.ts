import type { ToolRegistration } from "@earendil-works/pi-durable";
import { formatSkillInvocation, type Skill } from "../skills/index.ts";
import { Type } from "typebox";

const schema = Type.Object({ name: Type.String({ description: "Name of the skill to load." }) });

export function createSkillTool(
  getSkill: (name: string) => Skill | undefined,
): ToolRegistration<typeof schema> {
  return {
    name: "skill",
    description: "Load a skill's full instructions by name from the available skills list.",
    parameters: schema,
    async execute({ name }, _api, context) {
      const signal = context.abortSignal;
      signal?.throwIfAborted();
      const skill = getSkill(name);
      if (!skill) throw new Error(`Skill not found: ${name}`);
      if (skill.disableModelInvocation)
        throw new Error(`Skill is not available for model invocation: ${name}`);
      return {
        content: [{ type: "text", text: formatSkillInvocation(skill) }],
        details: undefined,
      };
    },
  };
}
