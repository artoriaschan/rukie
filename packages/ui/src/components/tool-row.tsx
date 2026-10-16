import type { TraceReaderState, TraceOutputPage } from "../lib/trace-reader";
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
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  source:
    | { path: string; patch: string }
    | { path: string; oldText: string | null; newText: string };
}) {
  const patch =
    "patch" in source
      ? source.patch
      : createTwoFilesPatch(source.path, source.path, source.oldText ?? "", source.newText);
  const t = useAppText();
  const [lines, setLines] = useState<FileDiffLine[]>([]);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let parsed: ReturnType<typeof parsePatch>;
    try {
      parsed = parsePatch(patch);
      if ("patch" in source && patch.trim() && !parsed.length) throw new Error("Invalid patch");
      setInvalid(false);
    } catch {
      setInvalid(true);
      setLines([]);
      return;
    }
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
  if (invalid)
    return (
      <div>
        <p role="alert" className="text-ui-control text-danger">
          {t("conversation.diff-error")}
        </p>
        <AnsiOutput text={patch} />
      </div>
    );
  return (
    <FileDiff
      file={source.path}
      lines={lines}
      status="complete"
      defaultOpen
      open={open}
      onOpenChange={onOpenChange}
      maxHeight={null}
      collapseOnComplete={false}
      copyText={patch}
    />
  );
}
export type ReadToolOutput = (ref: ToolOutputRef, offset: number) => Promise<JobOutput>;
export function ToolRow({
  tool,
  readOutput,
  open: controlledOpen,
  onOpenChange,
  reader,
  identity = tool.id,
}: {
  reader?: TraceReaderState;
  identity?: string;
  tool: TranscriptTool;
  readOutput?: ReadToolOutput;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useAppText();
  const [localOutput, setLocalOutput] = useState<TraceOutputPage>({ cursor: 0, end: false });
  const { page, cursor, end } = reader?.outputPages[identity] ?? localOutput;
  const showOutput = (next: TraceOutputPage) => {
    if (reader) reader.showOutput(identity, next);
    else setLocalOutput(next);
  };
  const [pending, setPending] = useState(false);
  const [outputError, setOutputError] = useState(false);
  const [choice, setChoice] = useState<boolean>();
  const open = controlledOpen ?? choice ?? tool.status === "error";
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setChoice(next);
    onOpenChange?.(next);
  };
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
      showOutput({ page: value, cursor: offset, end: value.nextOffset === offset });
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
        status={tool.status === "cancelled" ? "unknown" : tool.status}
        kind={call?.card === "terminal" ? "terminal" : "custom"}
        open={open}
        onOpenChange={setOpen}
        collapseOnComplete={false}
        maxHeight={null}
        copyText={output}
      >
        {call ? (
          <section aria-label={t("conversation.parameters")} className="mb-2">
            <h4 className="text-ui-control text-muted-foreground">
              {t("conversation.parameters")}
            </h4>
            <pre className="whitespace-pre-wrap break-words font-mono text-ui-control">
              {call.card === "terminal"
                ? call.command
                : call.card === "diff"
                  ? call.diffs.map((diff) => diff.path).join("\n")
                  : (call.title ?? tool.name)}
            </pre>
          </section>
        ) : null}
        <section aria-label={t("conversation.result")}>
          <h4 className="text-ui-control text-muted-foreground">{t("conversation.result")}</h4>
          {diffs.length && !page ? (
            diffs.map((source, index) => (
              <Diff
                key={index}
                source={source}
                open={reader ? (reader.choices[`diff:${identity}:${index}`] ?? true) : undefined}
                onOpenChange={
                  reader ? (open) => reader.choose(`diff:${identity}:${index}`, open) : undefined
                }
              />
            ))
          ) : output ? (
            <AnsiOutput text={output} />
          ) : (
            <p className="text-ui-control text-muted-foreground">
              {t(result ? "conversation.output-empty" : "conversation.output-missing")}
            </p>
          )}
          {readOutput && result?.outputRef ? (
            <div>
              <Button
                variant="ghost"
                size="contextual"
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
                  size="contextual"
                  disabled={pending}
                  onClick={() => {
                    showOutput({ cursor: 0, end: false });
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
        </section>
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
