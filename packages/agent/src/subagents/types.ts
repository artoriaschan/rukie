import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  HooksSchema,
  createUserVisibleError,
  type HooksSettings,
  type UserVisibleErrorData,
} from "@neant/shared";
import { mergeHooks, validateHooks } from "../hooks/index.ts";

const Metadata = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  tools: Type.Optional(Type.Array(Type.String())),
  model: Type.Optional(Type.String()),
  hooks: Type.Optional(HooksSchema),
});
const MetadataFields = Type.Omit(Metadata, ["hooks"]);

export interface SubagentType extends Omit<Static<typeof Metadata>, "hooks"> {
  hooks?: HooksSettings;
  prompt: string;
}

/** The same home/project namespace order as skills; later definitions win. */
export async function discoverSubagentTypes(
  cwd: string,
  homeDir: string,
  tools: readonly string[],
  options: { trusted?: boolean } = {},
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
        tools: [
          "read",
          "glob",
          "grep",
          "skill",
          "todo_write",
          "web_fetch",
          "ask_user_question",
        ].filter((name) => tools.includes(name)),
        prompt: "",
      },
    ],
  ]);
  const warnings: string[] = [];
  const hookWarnings: { source: string; message: string; error: UserVisibleErrorData }[] = [];
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
          const [error] = Value.Errors(MetadataFields, metadata);
          if (error) throw new Error(`${error.instancePath || "/"} ${error.message}`);
          const definition = metadata as Static<typeof Metadata>;
          const { hooks: rawHooks, ...fields } = metadata as Static<typeof Metadata> & {
            hooks?: unknown;
          };
          let hooks: HooksSettings | undefined;
          if (rawHooks !== undefined) {
            if (root === cwd && !options.trusted) {
              const message = `${path}: ignoring hooks; only trusted projects can define hooks`;
              warnings.push(message);
              hookWarnings.push({
                source: path,
                message,
                error: { code: "hook-project-untrusted", params: { source: path } },
              });
            } else {
              const [invalid] = Value.Errors(HooksSchema, rawHooks);
              if (invalid) {
                const source = `${path}: /hooks${invalid.instancePath}`;
                throw createUserVisibleError(`${source} ${invalid.message}`, {
                  code: "hook-config-invalid",
                  params: { source, cause: invalid.message },
                });
              }
              const configured = rawHooks as HooksSettings;
              validateHooks(configured, path);
              const { Stop, ...events } = configured;
              hooks = mergeHooks({ ...(Stop && { SubagentStop: Stop }) }, events);
            }
          }
          if (definition.name === "fork")
            throw new Error('name "fork" is reserved for subagent_fork.');
          const allowed = definition.tools?.filter((name) => {
            if (tools.includes(name)) return true;
            warnings.push(`${path}: unknown tool "${name}" ignored.`);
            return false;
          });
          types.set(definition.name, {
            ...fields,
            ...(hooks && { hooks }),
            ...(allowed && { tools: allowed }),
            prompt: raw.slice(match[0].length).trim(),
          });
        } catch (error) {
          const message = `${path}: ${error instanceof Error ? error.message : String(error)}`;
          warnings.push(message);
          if (error instanceof Error && "code" in error && "params" in error)
            hookWarnings.push({
              source: path,
              message,
              error: error as Error & UserVisibleErrorData,
            });
        }
      }
    }
  }
  return { types, warnings, hookWarnings };
}
