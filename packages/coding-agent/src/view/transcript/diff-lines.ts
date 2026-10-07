import type { ToolCallView, ToolResultView } from "@neant/shared";
import { createTwoFilesPatch, parsePatch } from "diff";

type DiffView = Extract<ToolCallView | ToolResultView, { card: "diff" }>;
export interface DiffLine {
  text: string;
  tone: "path" | "add" | "del" | "dim" | "plain";
  path?: string;
  runs?: { text: string }[];
}
/** Keep file boundaries and hunk gaps, omitting unified-patch protocol headers. */
export function unifiedDiffLines(
  view: DiffView,
  highlight: (source: string, options: { path: string }) => { text: string }[][] = (source) =>
    source.split("\n").map((text) => [{ text }]),
): DiffLine[] {
  return view.diffs.flatMap((file) => {
    const rows: DiffLine[] = [{ text: file.path, tone: "path", path: file.path }];
    const patch =
      "patch" in file
        ? file.patch
        : createTwoFilesPatch(file.path, file.path, file.oldText ?? "", file.newText);
    for (const parsed of parsePatch(patch)) {
      const oldSource =
        "oldText" in file
          ? (file.oldText ?? "")
          : parsed.hunks
              .flatMap((h) =>
                h.lines
                  .filter((line) => !line.startsWith("+") && !line.startsWith("\\"))
                  .map((line) => line.slice(1)),
              )
              .join("\n");
      const newSource =
        "newText" in file
          ? file.newText
          : parsed.hunks
              .flatMap((h) =>
                h.lines
                  .filter((line) => !line.startsWith("-") && !line.startsWith("\\"))
                  .map((line) => line.slice(1)),
              )
              .join("\n");
      const oldRuns = highlight(oldSource, { path: file.path });
      const newRuns = highlight(newSource, { path: file.path });
      let patchOld = 0;
      let patchNew = 0;
      parsed.hunks.forEach((hunk, index) => {
        if (index) rows.push({ text: "⋯", tone: "dim" });
        let oldIndex = "oldText" in file ? Math.max(0, hunk.oldStart - 1) : patchOld;
        let newIndex = "newText" in file ? Math.max(0, hunk.newStart - 1) : patchNew;
        for (const text of hunk.lines) {
          if (text.startsWith("\\")) continue;
          const tone = text.startsWith("+") ? "add" : text.startsWith("-") ? "del" : "plain";
          const runs = tone === "del" ? oldRuns[oldIndex] : newRuns[newIndex];
          rows.push({
            text,
            tone,
            runs: [{ text: text[0]! }, ...(runs ?? [{ text: text.slice(1) }])],
          });
          if (tone !== "add") oldIndex++;
          if (tone !== "del") newIndex++;
        }
        patchOld = oldIndex;
        patchNew = newIndex;
      });
    }
    return rows;
  });
}
