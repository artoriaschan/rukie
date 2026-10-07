import { Markdown } from "./markdown";
import { useEffect, useState } from "react";
import {
  Box,
  ThemedText,
  hex,
  interpolateColor,
  rgb,
  useSmoothText,
  useTerminalSize,
  useTheme,
} from "../../ink/index.ts";
import type { Locale } from "@rukie/i18n";
import { fmtDuration } from "@rukie/i18n";
import { createTuiI18n } from "../../view/i18n";

/** Clip by grapheme width; the ticker's final row preserves newly arrived tokens. */
function clip(text: string, width: number, fromStart = false) {
  if (Bun.stringWidth(text) <= width) return text;
  const parts = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (part) => part.segment,
  );
  let result = "";
  for (const part of fromStart ? parts.reverse() : parts) {
    if (Bun.stringWidth(result + part) > width - 1) break;
    result = fromStart ? part + result : result + part;
  }
  return fromStart ? "…" + result : result + "…";
}

export function ThinkingRow({
  text,
  expanded,
  onToggle,
  locale,
  streaming = false,
  preview = false,
  revealKey = "thinking",
  durationMs,
}: {
  text: string;
  expanded: boolean;
  onToggle(): void;
  locale: Locale;
  streaming?: boolean;
  preview?: boolean;
  revealKey?: string;
  durationMs?: number;
}) {
  const { columns } = useTerminalSize();
  const t = createTuiI18n(locale);
  const theme = useTheme();
  const [frame, setFrame] = useState(0);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setFrame((value) => value + 1), 80);
    return () => clearInterval(timer);
  }, [streaming]);
  const pulseColor = hex(
    interpolateColor(
      rgb(theme.activity),
      rgb(theme.activityFlash),
      (Math.sin(frame * 0.9) + 1) / 2,
    ),
  );
  const shown = useSmoothText(revealKey, text, streaming);
  const duration =
    durationMs !== undefined && durationMs >= 1000 ? ` · ${fmtDuration(durationMs, locale)}` : "";
  const title = `${t("subagent.thinking")}${duration}${streaming ? "…" : ` ${t("thinking.expand")}`}`;
  const lines = text.split("\n");
  const rows = lines.slice(-3);
  return (
    <Box width="100%" flexShrink={0} flexDirection="column" gap={expanded ? 1 : 0}>
      <Box
        flexShrink={0}
        width="100%"
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Box width={streaming ? 2 : 3} flexShrink={0} noSelect>
          <ThemedText color={streaming ? pulseColor : undefined} dim={!streaming}>
            {streaming ? "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[frame % 10] : "🧠"}
          </ThemedText>
        </Box>
        <ThemedText dim={!hovered} italic>
          {title}
        </ThemedText>
      </Box>
      {expanded ? (
        <Box flexShrink={0} paddingLeft={2}>
          <Markdown text={shown} dim />
        </Box>
      ) : (
        preview && (
          <Box flexDirection="column" height={3} flexShrink={0} paddingLeft={2}>
            {Array.from({ length: 3 }, (_, index) => (
              <Box flexShrink={0} key={index} height={1}>
                <Box width={2} flexShrink={0} noSelect>
                  <ThemedText dim italic>
                    {"│"}
                  </ThemedText>
                </Box>
                <ThemedText dim italic wrap="truncate">
                  {clip(
                    index === 0 && lines.length > 3 ? `…${rows[index]}` : (rows[index] ?? " "),
                    Math.max(1, columns - 4),
                    index === rows.length - 1,
                  )}
                </ThemedText>
              </Box>
            ))}
          </Box>
        )
      )}
    </Box>
  );
}
