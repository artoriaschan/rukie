import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const Metadata = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  tools: Type.Optional(Type.Array(Type.String())),
  model: Type.Optional(Type.String()),
});

export interface SubagentType extends Static<typeof Metadata> {
  prompt: string;
}

/** The same home/project namespace order as skills; later definitions win. */
export async function discoverSubagentTypes(
  cwd: string,
  homeDir: string,
  tools: readonly string[],
) {
  const types = new Map<string, SubagentType>([
    [
      "general-purpose",
      { name: "general-purpose", description: "General-purpose delegated work", prompt: "" },
    ],
    [
      "explore",
      {
        name: "explore",
        description: "Read-only exploration",
        tools: ["read", "glob", "grep", "skill", "todo_write", "ask_user_question"].filter((name) =>
          tools.includes(name),
        ),
        prompt: "",
      },
    ],
  ]);
  const warnings: string[] = [];
  for (const root of [homeDir, cwd]) {
    for (const namespace of [".neant", ".claude", ".agents"]) {
      const directory = join(root, namespace, "agents");
      let files: string[];
      try {
        files = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          warnings.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const filename of files.sort().filter((name) => name.endsWith(".md"))) {
        const path = join(directory, filename);
        try {
          const raw = await Bun.file(path).text();
          const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
          if (!match) throw new Error("frontmatter is required.");
          const metadata: unknown = Bun.YAML.parse(match[1]!);
          const [error] = Value.Errors(Metadata, metadata);
          if (error) throw new Error(`${error.instancePath || "/"} ${error.message}`);
          const definition = metadata as Static<typeof Metadata>;
          if (definition.name === "fork")
            throw new Error('name "fork" is reserved for subagent_fork.');
          const allowed = definition.tools?.filter((name) => {
            if (tools.includes(name)) return true;
            warnings.push(`${path}: unknown tool "${name}" ignored.`);
            return false;
          });
          types.set(definition.name, {
            ...definition,
            ...(allowed && { tools: allowed }),
            prompt: raw.slice(match[0].length).trim(),
          });
        } catch (error) {
          warnings.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  return { types, warnings };
}
