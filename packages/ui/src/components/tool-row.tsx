import type { JobOutput, ToolOutputRef } from "@rukie/shared";
import { Button } from "./motion/button/base";
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
export type ReadToolOutput = (ref: ToolOutputRef, offset: number) => Promise<JobOutput>;
export function ToolRow({
  tool,
  readOutput,
}: {
  tool: TranscriptTool;
  readOutput?: ReadToolOutput;
}) {
  const t = useAppText();
  const [page, setPage] = useState<JobOutput>();
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState(false);
  const [outputError, setOutputError] = useState(false);
  const [end, setEnd] = useState(false);
  const [open, setOpen] = useState(tool.status === "error");
  useEffect(() => {
    if (tool.status === "error") setOpen(true);
  }, [tool.status]);
  const call = tool.callView;
  const result = tool.resultView;
  const title =
    tool.name === "ask_user_question" ||
    tool.name === "enter_plan_mode" ||
    tool.name === "exit_plan_mode"
      ? t(`tool.${tool.name}`)
      : toolTitle(tool);
  const diffs = result?.card === "diff" ? result.diffs : call?.card === "diff" ? call.diffs : [];
  const boundedOutput =
    result?.card === "terminal"
      ? result.output
      : result?.card === "read"
        ? result.content
        : result?.card === "generic"
          ? result.text
          : tool.output;
  const output = page
    ? page.stdout + (page.stderr ? `\n[stderr]\n${page.stderr}` : "")
    : boundedOutput;
  const load = async (offset: number) => {
    if (!readOutput || !result?.outputRef || pending) return;
    setPending(true);
    setOutputError(false);
    try {
      const value = await readOutput(result.outputRef, offset);
      setPage(value);
      setCursor(offset);
      setEnd(value.nextOffset === offset);
    } catch {
      setOutputError(true);
    } finally {
      setPending(false);
    }
  };
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
        {diffs.length && !page ? (
          diffs.map((source, index) => <Diff key={index} source={source} />)
        ) : (
          <AnsiOutput text={output} />
        )}
        {readOutput && result?.outputRef ? (
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || (page !== undefined && end)}
              onClick={() => {
                void load(page?.nextOffset ?? 0);
              }}
            >
              {t(page ? "conversation.output-next" : "conversation.output-full")}
            </Button>
            {page ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setPage(undefined);
                  setCursor(0);
                  setEnd(false);
                }}
              >
                {t("conversation.output-summary")}
              </Button>
            ) : null}
            {page ? (
              <p className="text-ui-sm text-muted-foreground">
                {t("conversation.output-range", { start: cursor, end: page.nextOffset })}
              </p>
            ) : null}
            {outputError ? (
              <p role="alert" className="text-ui-sm text-danger">
                {t("conversation.output-error")}
              </p>
            ) : null}
          </div>
        ) : null}
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
      {result && "outputUnavailable" in result && result.outputUnavailable && !result.outputRef ? (
        <p className="text-ui-sm text-warning">{t("conversation.unavailable")}</p>
      ) : null}
    </>
  );
}
