import { useEffect, useState } from "react";
import { createTwoFilesPatch, parsePatch } from "diff";
import { toolTitle, type TranscriptTool } from "../lib/transcript";
import { ToolResult } from "./agents/tool-result";
import { FileDiff, type FileDiffLine } from "./agents/file-diff";
import { AnsiOutput } from "./ansi";
import { highlight } from "../lib/highlight";
import { useAppText } from "../lib/i18n";
function Diff({
  source,
}: {
  source:
    | { path: string; patch: string }
    | { path: string; oldText: string | null; newText: string };
}) {
  const patch =
    "patch" in source
      ? source.patch
      : createTwoFilesPatch(source.path, source.path, source.oldText ?? "", source.newText);
  const [lines, setLines] = useState<FileDiffLine[]>([]);
  useEffect(() => {
    let cancelled = false;
    const parsed = parsePatch(patch);
    const plain: FileDiffLine[] = [];
    for (const file of parsed)
      for (const hunk of file.hunks) {
        let old = hunk.oldStart,
          newLine = hunk.newStart;
        for (const line of hunk.lines) {
          const prefix = line[0];
          if (prefix !== "+" && prefix !== "-" && prefix !== " ") continue;
          plain.push({
            id: `${hunk.oldStart}-${plain.length}`,
            type: prefix === "+" ? "added" : prefix === "-" ? "removed" : "context",
            oldLine: prefix === "+" ? undefined : old++,
            newLine: prefix === "-" ? undefined : newLine++,
            content: line.slice(1),
          });
        }
      }
    setLines(plain);
    if ("oldText" in source) {
      const extension = source.path.split(".").at(-1) ?? "text";
      void Promise.all([
        highlight(source.oldText ?? "", extension),
        highlight(source.newText, extension),
      ])
        .then(([before, after]) => {
          if (!cancelled)
            setLines(
              plain.map((line) => ({
                ...line,
                tokens:
                  line.type === "removed"
                    ? before?.[(line.oldLine ?? 1) - 1]
                    : after?.[(line.newLine ?? 1) - 1],
              })),
            );
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [patch, source]);
  return (
    <FileDiff
      file={source.path}
      lines={lines}
      status="complete"
      defaultOpen
      collapseOnComplete={false}
      copyText={patch}
    />
  );
}
export function ToolRow({ tool }: { tool: TranscriptTool }) {
  const t = useAppText();
  const [open, setOpen] = useState(tool.status === "error");
  useEffect(() => {
    if (tool.status === "error") setOpen(true);
  }, [tool.status]);
  const call = tool.callView;
  const result = tool.resultView;
  const title = toolTitle(tool);
  const diffs = result?.card === "diff" ? result.diffs : call?.card === "diff" ? call.diffs : [];
  const output =
    result?.card === "terminal"
      ? result.output
      : result?.card === "read"
        ? result.content
        : result?.card === "generic"
          ? result.text
          : tool.output;
  return (
    <>
      <ToolResult
        tool={t(`conversation.action-${call?.kind ?? "other"}`)}
        title={title}
        status={tool.status}
        kind={call?.card === "terminal" ? "terminal" : "custom"}
        open={open}
        onOpenChange={setOpen}
        collapseOnComplete={false}
        copyText={output}
      >
        {diffs.length ? (
          diffs.map((source, index) => <Diff key={index} source={source} />)
        ) : (
          <AnsiOutput text={output} />
        )}
      </ToolResult>
      {tool.status === "cancelled" ? (
        <p className="text-ui-sm text-warning">{t("conversation.unknown")}</p>
      ) : null}
      {result?.card === "terminal" && result.fullOutputPath ? (
        <p className="font-mono text-ui-sm">{result.fullOutputPath}</p>
      ) : null}
      {result?.card === "read" && result.nextOffset !== undefined ? (
        <p className="text-ui-sm text-muted-foreground">
          {t("conversation.continue", { offset: result.nextOffset })}
        </p>
      ) : null}
      {result && "outputUnavailable" in result && result.outputUnavailable ? (
        <p className="text-ui-sm text-warning">{t("conversation.unavailable")}</p>
      ) : null}
    </>
  );
}
