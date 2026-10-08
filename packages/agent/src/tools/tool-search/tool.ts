import type { ToolRegistration } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { isDeferredToolCandidate } from "./loadout.ts";

const parameters = Type.Object(
  {
    query: Type.String(),
    max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  },
  { additionalProperties: false },
);

export function createToolSearchTool(input: {
  catalog: () => readonly ToolRegistration[];
  visibleNames: () => readonly string[] | Promise<readonly string[]>;
}): ToolRegistration<typeof parameters> {
  return {
    name: "ToolSearch",
    description:
      "Find and load deferred MCP tools. Use select:NAME,NAME to select exact tool names, or whitespace-separated keywords to search names and descriptions. Prefix a keyword with + to require it in the tool name. Loaded tools remain available in this conversation. max_results defaults to 5 (maximum 20) and does not limit select: queries.",
    parameters,
    async execute({ query, max_results }) {
      const candidates = input.catalog().filter(isDeferredToolCandidate);
      const visible = new Set(await input.visibleNames());
      const unknown: string[] = [];
      let matches: ToolRegistration[];
      if (query.trim().startsWith("select:")) {
        const requested = [
          ...new Set(
            query
              .trim()
              .slice(7)
              .split(",")
              .map((name) => name.trim())
              .filter(Boolean),
          ),
        ];
        const byName = new Map(candidates.map((tool) => [tool.name, tool]));
        matches = requested.flatMap((name) => {
          const tool = byName.get(name);
          if (tool) return [tool];
          unknown.push(name);
          return [];
        });
      } else {
        const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
        matches = candidates
          .map((tool, index) => {
            const name = tool.name.toLowerCase();
            const words = name.split(/_+/);
            const description = tool.description.toLowerCase();
            let score = 0;
            for (const term of terms) {
              const required = term.startsWith("+");
              const word = required ? term.slice(1) : term;
              if (!word || (required && !name.includes(word))) return { tool, index, score: 0 };
              if (name.includes(word)) score += words.includes(word) ? 10 : 5;
              else if (description.includes(word)) score += 1;
            }
            return { tool, index, score };
          })
          .filter(({ score }) => score > 0)
          .sort((left, right) => right.score - left.score || left.index - right.index)
          .slice(0, max_results ?? 5)
          .map(({ tool }) => tool);
      }
      const addTools = matches.filter((tool) => !visible.has(tool.name)).map((tool) => tool.name);
      const lines = matches.map(
        (tool) => `${tool.name}${visible.has(tool.name) ? " (already available)" : " (loaded)"}`,
      );
      if (unknown.length) lines.push(`Unknown tool names: ${unknown.join(", ")}`);
      if (!matches.length)
        lines.push(
          "No matching tools. Use select:NAME,NAME to select exact tool names from the deferred tools reminder.",
        );
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        ...(addTools.length ? { control: { addTools } } : {}),
      };
    },
  };
}
