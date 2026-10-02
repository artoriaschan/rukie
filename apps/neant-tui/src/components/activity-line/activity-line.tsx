import {
  figures,
  rgb,
  sweep,
  ThemedText,
  useAnimationFrame,
  useTerminalSize,
  useTheme,
} from "@neant/tui";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

interface Segment {
  text: string;
  color: `#${string}`;
  bold?: boolean;
}

function truncate(segments: Segment[], columns: number): Segment[] {
  if (Bun.stringWidth(segments.map(({ text }) => text).join("")) <= columns) return segments;
  let remaining = Math.max(0, columns - 1);
  const visible: Segment[] = [];
  for (const segment of segments) {
    let text = "";
    for (const { segment: char } of graphemes.segment(segment.text)) {
      const width = Bun.stringWidth(char);
      if (width > remaining) {
        visible.push({ ...segment, text: text + "…" });
        return visible;
      }
      text += char;
      remaining -= width;
    }
    visible.push({ ...segment, text });
  }
  return visible;
}

export function ActivityLine({
  phase,
  line,
  suffix,
}: {
  phase: "waiting" | "thinking" | "tool" | "done";
  line: string;
  suffix: string;
}) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const [, time] = useAnimationFrame(phase === "done" ? null : 60);
  const base = phase === "tool" ? theme.accent : theme.activity;
  const { frames, intervalMs } = figures.activityFrames;
  const segments: Segment[] =
    phase === "done"
      ? [{ text: line, color: theme.accent }]
      : [
          { text: `${frames[Math.floor(time / intervalMs) % frames.length]} `, color: base },
          ...sweep(line, time, rgb(base), rgb(theme.activityFlash)).map((segment) => ({
            ...segment,
            bold: true,
          })),
        ];
  segments.push({ text: suffix, color: theme.subtle });
  return (
    <ThemedText wrap="truncate">
      {truncate(segments, columns).map((segment, index) => (
        <ThemedText key={index} color={segment.color} bold={segment.bold}>
          {segment.text}
        </ThemedText>
      ))}
    </ThemedText>
  );
}
