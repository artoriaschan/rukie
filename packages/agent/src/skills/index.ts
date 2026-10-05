import { formatSkillInvocation, loadSkills, type Skill } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { join } from "node:path";

export async function discoverSkills(cwd: string, homeDir: string) {
  const env = new NodeExecutionEnv({ cwd });
  const paths = [homeDir, cwd].flatMap((root) =>
    [".neant", ".claude", ".agents"].map((namespace) => join(root, namespace, "skills")),
  );
  const loaded = await loadSkills(env, paths, BACKGROUND_CONTEXT);
  const warnings = loaded.diagnostics.map(
    (diagnostic) => `${diagnostic.path}: ${diagnostic.message}`,
  );
  // pi returns some invalid skills alongside diagnostics; Neant skips them.
  const invalidPaths = new Set(loaded.diagnostics.map((diagnostic) => diagnostic.path));
  const skills = new Map<string, Skill>();
  const invocable = new Map<string, { name: string; description: string }>();
  for (const skill of loaded.skills) {
    if (invalidPaths.has(skill.filePath)) continue;
    try {
      // pi falls back to the directory name when frontmatter.name is absent.
      // Agent Skills requires an explicit name, so check that field as well.
      const raw = await Bun.file(skill.filePath).text();
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)?.[1];
      const metadata = frontmatter === undefined ? undefined : Bun.YAML.parse(frontmatter);
      if (
        !metadata ||
        typeof metadata !== "object" ||
        !("name" in metadata) ||
        metadata.name !== skill.name
      ) {
        warnings.push(`${skill.filePath}: frontmatter.name is required and must be a string`);
        continue;
      }
      skills.set(skill.name, skill);
      if (!("user-invocable" in metadata) || metadata["user-invocable"] !== false)
        invocable.set(skill.name, { name: skill.name, description: skill.description });
      else invocable.delete(skill.name);
    } catch (error) {
      warnings.push(`${skill.filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { skills, warnings, invocable: [...invocable.values()] };
}

/** Discover the skill names a frontend may offer for explicit user invocation. */
export async function listSkills(options: { cwd: string; homeDir: string }) {
  return (await discoverSkills(options.cwd, options.homeDir)).invocable;
}

export function skillsReminder(skills: ReadonlyMap<string, Skill>): string {
  if (skills.size === 0) return "Available skills: none.";
  return (
    "Available skills (use the skill tool to load instructions by name):\n" +
    [...skills.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join("\n")
  );
}

export function skillInvocation(
  prompt: string,
  skills: ReadonlyMap<string, Skill>,
): string | undefined {
  const name = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/.exec(prompt)?.[1];
  const skill = name ? skills.get(name) : undefined;
  return skill ? formatSkillInvocation(skill) : undefined;
}
