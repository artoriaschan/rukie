import { createEditTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import { createTwoFilesPatch } from "diff";
import { normalizeFileTool } from "./runtime.ts";
import type { PresentedTool } from "./presentation.ts";
import type { ToolResultView } from "@rukie/shared";
const DIFF_TEXT_LIMIT = 50 * 1024;
type WriteFacts = { path: string } & (
  | { oldText: string | null; newText: string }
  | { patch: string }
);

function diffResult(
  details: unknown,
  path: string,
  displayKey: string,
): ToolResultView | undefined {
  if (typeof details !== "object" || details === null) return;
  const actualPath = "path" in details && typeof details.path === "string" ? details.path : path;
  if ("patch" in details && typeof details.patch === "string")
    return {
      card: "diff",
      kind: "edit",
      displayKey,
      diffs: [{ path: actualPath, patch: details.patch }],
    };
  if (
    "oldText" in details &&
    (typeof details.oldText === "string" || details.oldText === null) &&
    "newText" in details &&
    typeof details.newText === "string"
  )
    return {
      card: "diff",
      kind: "edit",
      displayKey,
      diffs: [{ path: actualPath, oldText: details.oldText, newText: details.newText }],
    };
}
function createPresentedWrite(cwd: string, homeDir: string) {
  const tool = normalizeFileTool(createWriteTool(), cwd, homeDir);
  const presented: PresentedTool<typeof tool.parameters, WriteFacts> = {
    ...tool,
    async execute(args, api, context) {
      if (!api.env) throw new Error("write requires an execution environment");
      let facts: WriteFacts | undefined;
      const env = new Proxy(api.env, {
        get(target, property) {
          if (property === "writeFile")
            return async (path: string, content: string | Uint8Array, ctx: typeof context) => {
              if (typeof content === "string") {
                const previous = await target.readTextFile(path, ctx);
                const oldText = previous.ok
                  ? previous.value
                  : previous.error.code === "not_found"
                    ? null
                    : undefined;
                if (oldText !== undefined)
                  facts =
                    Buffer.byteLength(oldText ?? "") > DIFF_TEXT_LIMIT ||
                    Buffer.byteLength(content) > DIFF_TEXT_LIMIT
                      ? { path, patch: createTwoFilesPatch(path, path, oldText ?? "", content) }
                      : { path, oldText, newText: content };
              }
              return target.writeFile(path, content, ctx);
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const result = await tool.execute(args, { ...api, env }, context);
      return { ...result, details: facts };
    },
    presentCall(args) {
      return { card: "generic", kind: "edit", displayKey: "tool.write", title: args.path };
    },
    presentResult(args, _text, details) {
      return diffResult(details, args.path, "tool.write");
    },
  };
  return presented;
}
function createPresentedEdit(cwd: string, homeDir: string) {
  const tool = normalizeFileTool(createEditTool(), cwd, homeDir);
  const presented: PresentedTool<
    typeof tool.parameters,
    { diff: string; patch: string; firstChangedLine?: number; path: string }
  > = {
    ...tool,
    async execute(args, api, context) {
      const result = await tool.execute(args, api, context);
      return {
        ...result,
        details: result.details
          ? { ...result.details, path: tool.prepareArguments!(args).path }
          : undefined,
      };
    },
    presentCall(args) {
      return {
        card: "diff",
        kind: "edit",
        displayKey: "tool.edit",
        diffs: args.edits.map((edit) => ({ path: args.path, ...edit })),
      };
    },
    presentResult(args, _text, details) {
      return diffResult(details, args.path, "tool.edit");
    },
  };
  return presented;
}

export function createPresentedFileTools(cwd: string, homeDir: string) {
  return [createPresentedWrite(cwd, homeDir), createPresentedEdit(cwd, homeDir)] as const;
}
