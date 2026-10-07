import type { ToolCallView, ToolResultView } from "@neant/shared";
// Presentation adapted from dsh-TUI src/components/Chat/SubagentMessage.tsx (MIT).
// https://github.com/ccch1mneyyy/dsh-TUI
/*
MIT License

Copyright (c) 2026, chimney (ccch1mneyyy)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { useState } from "react";
import type { Locale } from "@neant/i18n";
import {
  Box,
  figures,
  ThemedBox,
  ThemedText,
  useAnimationFrame,
  toolKindColor,
} from "../../../ink/index.ts";
import { createTuiI18n } from "../../../view/i18n";
import { subagentStatusKey, subagentElapsed, subagentAppearance } from "./presentation";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function singleLine(text: string) {
  return (
    Bun.stripANSI(text)
      // oxlint-disable-next-line no-control-regex -- child content cannot inject terminal controls
      .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
  );
}
function clip(text: string, width: number) {
  const clean = singleLine(text);
  if (Bun.stringWidth(clean) <= width) return clean;
  let result = "";
  let used = 0;
  for (const { segment } of graphemes.segment(clean)) {
    const size = Bun.stringWidth(segment);
    if (used + size > Math.max(0, width - 1)) break;
    result += segment;
    used += size;
  }
  return width > 0 ? result + "…" : "";
}

export interface SubagentOutput {
  type: "user" | "text" | "thinking" | "tool";
  text: string;
  toolId?: string;
}
export interface SubagentView {
  agentId: string;
  childSessionId: string;
  description: string;
  subagentType: string;
  status: "idle" | "running" | "completed" | "failed" | "aborted";
  runOutcome?:
    | "completed"
    | "aborted"
    | "error"
    | "length"
    | "hook_stopped"
    | "hook_blocked"
    | "interrupted"
    | "unknown";
  runReason?: string;
  model?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  tokens?: number;
  toolCalls: readonly {
    id: string;
    name: string;
    argsPreview: string;
    view?: ToolCallView;
    args?: unknown;
    resultView?: ToolResultView;
    result?: string;
    endedAt?: number;
    status: "running" | "completed" | "failed" | "unknown";
    startedAt?: number;
    durationMs?: number;
    resultPreview?: string;
    error?: string;
  }[];
  outputLines: readonly string[];
  error?: string;
}

export function SubagentMessage({
  subagent,
  columns,
  effort,
  locale = "zh",
  onClick,
  onOpenView,
}: {
  subagent: SubagentView;
  columns: number;
  effort?: string;
  locale?: Locale;
  onClick?(): void;
  onOpenView?(): void;
}) {
  const t = createTuiI18n(locale);
  const running = subagent.status === "running";
  const [, time] = useAnimationFrame(running ? 120 : null);
  const [hovered, setHovered] = useState(false);
  const { color, glyph: settledGlyph } = subagentAppearance(subagent);
  const { frames, intervalMs } = figures.activityFrames;
  const glyph = running
    ? ` ${frames[Math.floor(time / intervalMs) % frames.length]}`
    : settledGlyph;
  const elapsed = subagentElapsed(subagent);
  const seconds = elapsed === undefined ? undefined : Math.floor(elapsed / 1000);
  const duration =
    seconds === undefined
      ? undefined
      : seconds < 60
        ? `${seconds}s`
        : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
  const active = subagent.toolCalls.findLast((tool) => tool.status === "running");
  const previous = active
    ? subagent.toolCalls[subagent.toolCalls.indexOf(active) - 1]
    : subagent.toolCalls.at(-1);
  const latestTool = active ?? previous;
  const rowWidth = Math.max(0, columns - 6);
  return (
    <ThemedBox
      flexDirection="column"
      width={columns}
      paddingLeft={2}
      onMouseEnter={onClick ? () => setHovered(true) : undefined}
      onMouseLeave={onClick ? () => setHovered(false) : undefined}
    >
      <Box>
        <Box width={Math.max(1, columns - 5)} flexShrink={1}>
          <ThemedText wrap="truncate" onClick={onClick}>
            <ThemedText selectable={false} color={hovered ? "accent" : color}>
              {glyph}{" "}
            </ThemedText>
            <ThemedText bold color={hovered ? "accent" : undefined}>
              {t("subagent.prefix")}
              {singleLine(subagent.description)}
            </ThemedText>
            {subagent.model && (
              <>
                <ThemedText dimColor> · </ThemedText>
                {singleLine(subagent.model)}
              </>
            )}
            {effort && <ThemedText dimColor>{` · ${effort}`}</ThemedText>}
            <ThemedText
              dimColor
            >{`${duration === undefined ? "" : ` · ${duration}`}${subagent.tokens === undefined ? "" : ` · ${subagent.tokens} tok`} · ${subagent.toolCalls.length} tools · `}</ThemedText>
            <ThemedText color={color}>{t(subagentStatusKey(subagent))}</ThemedText>
          </ThemedText>
        </Box>
        {onOpenView && (
          <ThemedText selectable={false} onClick={onOpenView} color={hovered ? "accent" : "subtle"}>
            {" ⤢"}
          </ThemedText>
        )}
      </Box>
      {running && (
        <ThemedText wrap="truncate" onClick={onClick}>
          {previous && (
            <>
              <ThemedText dimColor>{"  · "}</ThemedText>
              <ThemedText
                selectable={false}
                color={
                  previous.status === "failed"
                    ? "error"
                    : previous.status === "unknown"
                      ? "subtle"
                      : "success"
                }
              >
                {previous.status === "failed" ? "✗" : previous.status === "unknown" ? "?" : "✓"}
              </ThemedText>
              <ThemedText color={toolKindColor(previous.view?.kind)}>{previous.name}</ThemedText>
            </>
          )}
          {active && (
            <>
              {previous && <ThemedText dimColor>{" · "}</ThemedText>}
              <ThemedText color={toolKindColor(active.view?.kind)}>{active.name}</ThemedText>
            </>
          )}
          {latestTool?.argsPreview && (
            <ThemedText
              dimColor
            >{` (${clip(latestTool.argsPreview, Math.max(0, rowWidth - latestTool.name.length - 6))})`}</ThemedText>
          )}
          {!active && !previous && " "}
        </ThemedText>
      )}
      {running &&
        Array.from({ length: 3 }, (_, index) => (
          <ThemedText key={index} dimColor wrap="truncate" onClick={onClick}>
            <ThemedText selectable={false}>{"  │ "}</ThemedText>
            {clip(subagent.outputLines.slice(-3)[index] ?? "", rowWidth)}
          </ThemedText>
        ))}
      {(subagent.status === "failed" || subagent.runOutcome === "error") && subagent.error && (
        <ThemedText color="error" wrap="truncate" onClick={onClick}>
          <ThemedText selectable={false}>{"  └ "}</ThemedText>
          {clip(subagent.error, rowWidth)}
        </ThemedText>
      )}
    </ThemedBox>
  );
}
