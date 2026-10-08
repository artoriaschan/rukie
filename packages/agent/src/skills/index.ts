import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import ignore from "ignore";

export interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
}

export function formatSkillInvocation(skill: Skill): string {
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${dirname(skill.filePath)}.\n\n${skill.content}\n</skill>`;
}

export async function discoverSkills(cwd: string, homeDir: string) {
  const warnings: string[] = [];
  const skills = new Map<string, Skill>();
  const invocable = new Map<string, { name: string; description: string }>();
  const paths = [homeDir, cwd].flatMap((root) =>
    [".rukie", ".claude", ".agents"].map((namespace) => join(root, namespace, "skills")),
  );
  for (const root of paths) {
    const visited = new Set<string>();
    const matcher = ignore();
    async function walk(path: string, relative: string) {
      let entries;
      try {
        entries = await readdir(path, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          warnings.push(`${path}: ${String(error)}`);
        return;
      }
      for (const name of [".gitignore", ".ignore", ".fdignore"]) {
        try {
          matcher.add(await readFile(join(path, name), "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            warnings.push(`${join(path, name)}: ${String(error)}`);
        }
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith(".")) continue;
        const next = join(path, entry.name),
          rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (matcher.ignores(rel)) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          try {
            const info = await stat(next);
            if (!info.isDirectory()) continue;
            const key = `${info.dev}:${info.ino}`;
            if (visited.has(key)) continue;
            visited.add(key);
            await walk(next, rel);
          } catch (error) {
            warnings.push(`${next}: ${String(error)}`);
          }
          continue;
        }
        if (entry.name !== "SKILL.md" && (relative || !entry.name.endsWith(".md"))) continue;
        try {
          const raw = await readFile(next, "utf8");
          const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
          if (!match) throw new Error("Required skill frontmatter is missing.");
          const metadata: unknown = Bun.YAML.parse(match[1]!);
          if (
            !metadata ||
            typeof metadata !== "object" ||
            !("name" in metadata) ||
            typeof metadata.name !== "string" ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) ||
            metadata.name.length > 64
          )
            throw new Error("Invalid skill name.");
          if (entry.name === "SKILL.md" && metadata.name !== basename(path))
            throw new Error("Skill name must match its directory.");
          if (
            !("description" in metadata) ||
            typeof metadata.description !== "string" ||
            !metadata.description.trim() ||
            metadata.description.length > 1024
          )
            throw new Error("Invalid skill description.");
          const skill: Skill = {
            name: metadata.name,
            description: metadata.description,
            content: match[2]!.trim(),
            filePath: next,
            ...("disable-model-invocation" in metadata &&
              metadata["disable-model-invocation"] === true && { disableModelInvocation: true }),
            ...("user-invocable" in metadata &&
              metadata["user-invocable"] === false && { userInvocable: false }),
          };
          skills.set(skill.name, skill);
          if (!("user-invocable" in metadata) || metadata["user-invocable"] !== false)
            invocable.set(skill.name, { name: skill.name, description: skill.description });
          else invocable.delete(skill.name);
        } catch (error) {
          warnings.push(`${next}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    await walk(root, "");
  }
  return { skills, warnings, invocable: [...invocable.values()] };
}

/** Discover the skill names a frontend may offer for explicit user invocation. */
export async function listSkills(options: { cwd: string; homeDir: string }) {
  return (await discoverSkills(options.cwd, options.homeDir)).invocable;
}

/** Compare only model-visible catalogs; publish a complete replacement when entries change. */
export function skillsReminder(
  skills: ReadonlyMap<string, Skill>,
  history: readonly string[],
  toolVisible: boolean,
): string | undefined {
  const entries = toolVisible
    ? [...skills.values()]
        .filter((skill) => !skill.disableModelInvocation)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((skill) => {
          const normalized = skill.description.replace(/\s+/g, " ").trim();
          return [
            skill.name,
            normalized.length <= 500 ? normalized : `${normalized.slice(0, 497)}...`,
          ] as const;
        })
    : [];
  const lines = entries.map(
    ([name, description]) =>
      `- ${name}: ${description.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}`,
  );
  const digest = (values: readonly string[]) =>
    createHash("sha256").update(JSON.stringify(values)).digest("hex");
  const previous = history.at(-1);
  const priorEntries = /<available_skills>\n([\s\S]*?)<\/available_skills>/.exec(
    previous ?? "",
  )?.[1];
  if (
    priorEntries !== undefined &&
    digest(priorEntries.trimEnd().split("\n").filter(Boolean)) === digest(lines)
  )
    return undefined;
  if (entries.length === 0 && previous === undefined) return undefined;
  return [
    "Available skills: this complete catalog replaces every earlier skill catalog.",
    "<available_skills>",
    ...lines,
    "</available_skills>",
    entries.length
      ? "Use the skill tool to load full instructions by name."
      : "No skills are available through the skill tool. Do not use names from earlier catalogs.",
  ].join("\n");
}

export function skillInvocation(
  prompt: string,
  skills: ReadonlyMap<string, Skill>,
): string | undefined {
  const name = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/.exec(prompt)?.[1];
  const skill = name ? skills.get(name) : undefined;
  return skill && skill.userInvocable !== false
    ? `The user invoked this skill directly; its full instructions are already included. Follow them and do not call the skill tool again for ${skill.name}.\n\n${formatSkillInvocation(skill)}`
    : undefined;
}
