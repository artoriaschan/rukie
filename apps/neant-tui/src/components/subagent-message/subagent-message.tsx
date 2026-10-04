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
import { figures, ThemedBox, ThemedText, useAnimationFrame, toolNameColor } from "@neant/tui";
import { createTuiI18n } from "../../i18n";

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

export interface SubagentView {
  agentId: string;
  childSessionId: string;
  description: string;
  subagentType: string;
  status: "idle" | "running" | "completed" | "failed" | "aborted";
  model?: string;
  startedAt: number;
  completedAt?: number;
  durationMs: number;
  tokens: number;
  toolCalls: readonly {
    id: string;
    name: string;
    argsPreview: string;
    status: "running" | "completed" | "failed";
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
}: {
  subagent: SubagentView;
  columns: number;
  effort?: string;
  locale?: Locale;
  onClick?(): void;
}) {
  const t = createTuiI18n(locale);
  const running = subagent.status === "running";
  const [, time] = useAnimationFrame(running ? 120 : null);
  const [hovered, setHovered] = useState(false);
  const failed = subagent.status === "failed" || subagent.status === "aborted";
  const color = failed ? "error" : subagent.status === "completed" ? "success" : "warning";
  const { frames, intervalMs } = figures.activityFrames;
  const glyph = running
    ? ` ${frames[Math.floor(time / intervalMs) % frames.length]}`
    : failed
      ? "🔴"
      : subagent.status === "idle"
        ? "·"
        : "🟢";
  const elapsed = running ? Math.max(0, Date.now() - subagent.startedAt) : subagent.durationMs;
  const seconds = Math.floor(elapsed / 1000);
  const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
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
      onClick={onClick}
      onMouseEnter={onClick ? () => setHovered(true) : undefined}
      onMouseLeave={onClick ? () => setHovered(false) : undefined}
    >
      <ThemedText wrap="truncate">
        <ThemedText color={hovered ? "accent" : color}>{glyph} </ThemedText>
        <ThemedText bold color={hovered ? "accent" : undefined}>
          {t("subagent.prefix")}
          {singleLine(subagent.description)}
        </ThemedText>
        <ThemedText dimColor> · </ThemedText>
        {singleLine(subagent.model ?? t("subagent.default-model"))}
        {effort && <ThemedText dimColor>{` · ${effort}`}</ThemedText>}
        <ThemedText
          dimColor
        >{` · ${duration} · ${subagent.tokens} tok · ${subagent.toolCalls.length} tools · `}</ThemedText>
        <ThemedText color={color}>{t(`subagent.status.${subagent.status}`)}</ThemedText>
      </ThemedText>
      {running && (
        <ThemedText wrap="truncate">
          {previous && (
            <>
              <ThemedText dimColor>{"  · "}</ThemedText>
              <ThemedText color="success">✓</ThemedText>
              <ThemedText color={toolNameColor(previous.name)}>{previous.name}</ThemedText>
            </>
          )}
          {active && (
            <>
              {previous && <ThemedText dimColor>{" · "}</ThemedText>}
              <ThemedText color={toolNameColor(active.name)}>{active.name}</ThemedText>
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
          <ThemedText
            key={index}
            dimColor
            wrap="truncate"
          >{`  │ ${clip(subagent.outputLines.slice(-3)[index] ?? "", rowWidth)}`}</ThemedText>
        ))}
      {subagent.status === "failed" && subagent.error && (
        <ThemedText
          color="error"
          wrap="truncate"
        >{`  └ ${clip(subagent.error, rowWidth)}`}</ThemedText>
      )}
    </ThemedBox>
  );
}
