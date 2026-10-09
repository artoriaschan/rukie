import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import type { UserVisibleErrorData } from "@rukie/shared";
import type { TSchema, Static } from "typebox";
import { prepareFileToolPath } from "./path.ts";

/** Normalize once before authorization; execute also accepts direct, validated calls. */
export function normalizeFileTool<T extends TSchema, D extends JsonValue>(
  tool: ToolRegistration<T, D>,
  cwd: string,
  homeDir: string,
): ToolRegistration<T, D> {
  const prepare = (input: unknown): Static<T> => {
    const args = tool.prepareArguments?.(input) ?? input;
    if (
      typeof args === "object" &&
      args !== null &&
      "path" in args &&
      typeof args.path === "string"
    ) {
      // The only changed field is an already checked path; native validation checks the full schema.
      return {
        ...args,
        path: prepareFileToolPath(args.path, tool.name === "read", cwd, homeDir),
      } as Static<T>;
    }
    // Native Harness performs schema validation after preparation.
    return args as Static<T>;
  };
  return {
    ...tool,
    prepareArguments: prepare,
    execute(args, api, context) {
      return tool.execute(prepare(args), api, context);
    },
  };
}

/** pi flattens thrown errors; keep coded details for frontend display and replay. */
export function preserveErrorDetails<T extends TSchema, D extends JsonValue>(
  tool: ToolRegistration<T, D>,
): ToolRegistration<T> {
  return {
    ...tool,
    async execute(...args) {
      try {
        return await tool.execute(...args);
      } catch (error) {
        if (error instanceof Error && "code" in error && "params" in error) {
          const { code, params } = error as Error & UserVisibleErrorData;
          return {
            isError: true,
            content: [{ type: "text", text: error.message }],
            details: { code, params },
          };
        }
        throw error;
      }
    },
  };
}

/** Shared bounds for built-in textual tool results. */
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const DEFAULT_MAX_LINES = 2000;

export function truncateHead(text: string) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines.slice(0, DEFAULT_MAX_LINES)) {
    const added = Buffer.byteLength(line) + (kept.length ? 1 : 0);
    if (bytes + added > DEFAULT_MAX_BYTES) break;
    bytes += added;
    kept.push(line);
  }
  const truncated = kept.length < lines.length;
  return {
    content: kept.join("\n"),
    truncated,
    truncatedBy: truncated ? (kept.length === DEFAULT_MAX_LINES ? "lines" : "bytes") : null,
  };
}
