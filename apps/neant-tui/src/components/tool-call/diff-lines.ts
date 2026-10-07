import type { ToolCallView, ToolResultView } from "@neant/shared";
import { createTwoFilesPatch, parsePatch } from "diff";

type DiffView = Extract<ToolCallView | ToolResultView, { card: "diff" }>;
export interface DiffLine {
  text: string;
  tone: "path" | "add" | "del" | "dim" | "plain";
  path?: string;
}
/** Keep file boundaries and hunk gaps, omitting unified-patch protocol headers. */
export function unifiedDiffLines(view: DiffView): DiffLine[] {
  return view.diffs.flatMap((file) => {
    const rows: DiffLine[] = [{ text: file.path, tone: "path", path: file.path }];
    const patch =
      "patch" in file
        ? file.patch
        : createTwoFilesPatch(file.path, file.path, file.oldText ?? "", file.newText);
    for (const parsed of parsePatch(patch)) {
      parsed.hunks.forEach((hunk, index) => {
        if (index) rows.push({ text: "⋯", tone: "dim" });
        rows.push(
          ...hunk.lines
            .filter((line) => !line.startsWith("\\"))
            .map((text): DiffLine => ({
              text,
              tone: text.startsWith("+") ? "add" : text.startsWith("-") ? "del" : "plain",
            })),
        );
      });
    }
    return rows;
  });
}
