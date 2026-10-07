import { AsyncLocalStorage } from "node:async_hooks";
import {
  createEditTool,
  createWriteTool,
  type EditToolDetails,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createTwoFilesPatch } from "diff";
import { adaptTool } from "./runtime.ts";
import type { PresentedTool } from "./presentation.ts";
import type { ToolResultView } from "@rukie/shared";

/** Store full before/after text only below the harness's 50 KiB output budget. */
const DIFF_TEXT_LIMIT = 50 * 1024;
type WriteFacts = { path: string } & (
  | { oldText: string | null; newText: string }
  | { patch: string }
);

/** The interception runs inside pi's mutation queue, immediately before its actual write. */
class DiffWriteEnv extends NodeExecutionEnv {
  readonly capture = new AsyncLocalStorage<{ facts?: WriteFacts }>();
  override async writeFile(...args: Parameters<NodeExecutionEnv["writeFile"]>) {
    const [path, content, context] = args;
    const capture = this.capture.getStore();
    if (capture && typeof content === "string") {
      const previous = await super.readTextFile(path, context);
      const oldText = previous.ok
        ? previous.value
        : previous.error.code === "not_found"
          ? null
          : undefined;
      if (oldText !== undefined) {
        capture.facts =
          Buffer.byteLength(oldText ?? "") > DIFF_TEXT_LIMIT ||
          Buffer.byteLength(content) > DIFF_TEXT_LIMIT
            ? { path, patch: createTwoFilesPatch(path, path, oldText ?? "", content) }
            : { path, oldText, newText: content };
      }
    }
    return super.writeFile(...args);
  }
}
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
function createPresentedWrite(env: DiffWriteEnv, homeDir: string) {
  const tool = adaptTool(createWriteTool(), env, homeDir);
  const presented: PresentedTool<typeof tool.parameters, WriteFacts | undefined> = {
    ...tool,
    async execute(...args) {
      const capture: { facts?: WriteFacts } = {};
      return env.capture.run(capture, async () => {
        const result = await tool.execute(...args);
        return { ...result, details: capture.facts };
      });
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
function createPresentedEdit(env: DiffWriteEnv, homeDir: string) {
  const tool = adaptTool(createEditTool(), env, homeDir);
  const presented: PresentedTool<typeof tool.parameters, EditToolDetails | undefined> = {
    ...tool,
    async execute(...args) {
      const result = await tool.execute(...args);
      return {
        ...result,
        details: result.details ? { ...result.details, path: args[1].path } : undefined,
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
  const env = new DiffWriteEnv({ cwd });
  return [createPresentedWrite(env, homeDir), createPresentedEdit(env, homeDir)] as const;
}
