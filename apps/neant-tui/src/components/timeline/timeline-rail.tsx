import { useEffect, useRef, useState } from "react";
import { Box, ThemedBox, ThemedText, type ScrollSnapshot } from "@neant/tui";
export interface TimelineInput {
  id: string;
  text: string;
  top: number;
}
/** One measured user-input list owns both the rail and pinned prompt. */
export function TimelineRail({
  inputs,
  snapshot,
  enabled,
  onSeek,
}: {
  inputs: readonly TimelineInput[];
  snapshot: ScrollSnapshot;
  enabled: boolean;
  onSeek(id: string): void;
}) {
  const active = Math.max(
    0,
    inputs.findLastIndex((input) => input.top <= snapshot.top),
  );
  const max = Math.max(0, snapshot.total - snapshot.height);
  const up = inputs.findLast((input) => input.top < snapshot.top);
  const down = inputs.find((input) => input.top > snapshot.top && input.top <= max);
  const count = Math.min(inputs.length, snapshot.height - 2);
  const tail = inputs.length - count;
  const start =
    inputs.length <= count
      ? 0
      : snapshot.following || snapshot.top === max
        ? Math.min(active, tail)
        : Math.min(tail, Math.max(0, active - Math.floor(count / 2)));
  const padding = Math.max(0, Math.floor((snapshot.height - count - 2) / 2));
  const [hover, setHover] = useState<string>();
  const [preview, setPreview] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setHover(undefined);
    setPreview(undefined);
  };
  useEffect(() => {
    clear();
  }, [snapshot.top, snapshot.width, snapshot.height, enabled]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const tick = (input: TimelineInput, index: number) => (
    <ThemedBox
      key={input.id}
      height={1}
      width={2}
      onClick={() => {
        clear();
        if (enabled) onSeek(input.id);
      }}
      onMouseEnter={() => {
        clear();
        if (!enabled) return;
        setHover(input.id);
        timer.current = setTimeout(() => setPreview(input.id), 120);
      }}
      onMouseLeave={clear}
    >
      <ThemedText
        preserveWhitespace
        color={index === active || hover === input.id ? undefined : "subtle"}
      >
        {index === active ? "━━" : hover === input.id ? "──" : " ─"}
      </ThemedText>
    </ThemedBox>
  );
  const previewIndex = inputs.findIndex((input) => input.id === preview);
  const shownPreview = inputs[previewIndex];
  const previewText = shownPreview
    ? previewLines(
        inputPreview(shownPreview.text),
        Math.min(32, Math.max(16, Math.floor(snapshot.width / 2))),
      )
    : [];
  const previewWidth = Math.max(0, ...previewText.map((line) => Bun.stringWidth(line))) + 4;
  const previewHeight = previewText.length + 2;
  const previewTop = Math.max(
    0,
    Math.min(
      padding + 1 + previewIndex - start - Math.floor(previewHeight / 2),
      snapshot.height - previewHeight,
    ),
  );
  return (
    <Box
      selectable={false}
      width={2}
      height={snapshot.height}
      flexShrink={0}
      flexDirection="column"
      paddingTop={padding}
      onWheel={clear}
    >
      <ThemedBox
        height={1}
        width={2}
        onClick={() => {
          clear();
          if (enabled && up) onSeek(up.id);
        }}
        onMouseEnter={() => {
          if (enabled) setHover("$up");
        }}
        onMouseLeave={clear}
      >
        <ThemedText
          preserveWhitespace
          color={!up ? "subtle" : hover === "$up" ? "text" : "inactive"}
        >
          {" "}
          ▴
        </ThemedText>
      </ThemedBox>
      {inputs.slice(start, start + count).map((input, index) => tick(input, start + index))}
      <ThemedBox
        height={1}
        width={2}
        onClick={() => {
          clear();
          if (enabled && down) onSeek(down.id);
        }}
        onMouseEnter={() => {
          if (enabled) setHover("$down");
        }}
        onMouseLeave={clear}
      >
        <ThemedText
          preserveWhitespace
          color={!down ? "subtle" : hover === "$down" ? "text" : "inactive"}
        >
          {" "}
          ▾
        </ThemedText>
      </ThemedBox>
      {shownPreview && enabled && previewHeight <= snapshot.height && (
        <ThemedBox
          position="absolute"
          right={3}
          top={previewTop}
          width={previewWidth}
          height={previewHeight}
          flexDirection="column"
          borderColor="inactive"
          textSelection={false}
          paddingX={1}
          borderStyle="round"
          backgroundColor="toolCardBackground"
        >
          <ThemedText wrap="truncate">{previewText.join("\n")}</ThemedText>
        </ThemedBox>
      )}
    </Box>
  );
}
function inputPreview(text: string) {
  const line =
    text
      .split(/\r?\n/u)
      .find((line) => line.trim())
      ?.trim() ?? "";
  const chars = [...line];
  return chars.length > 120 ? chars.slice(0, 119).join("") + "…" : line;
}

function previewLines(text: string, width: number): string[] {
  const rows = [""];
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    text,
  )) {
    const row = rows.length - 1;
    if (Bun.stringWidth(rows[row]! + segment) > width) {
      if (rows.length === 2) {
        const chars = [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(rows[row]!),
        ].map((value) => value.segment);
        while (Bun.stringWidth(chars.join("") + "…") > width) chars.pop();
        rows[row] = chars.join("") + "…";
        break;
      }
      rows.push(segment);
    } else rows[row] += segment;
  }
  return rows;
}
