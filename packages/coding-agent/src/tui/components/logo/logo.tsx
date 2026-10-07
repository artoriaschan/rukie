import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";
import { Box, ThemedText, useTerminalSize, useTheme } from "../../../ink/index.ts";
import type { ThinkingLevel } from "@neant/shared";
import { mergeColoredCells, renderBigText } from "./bigfont";
import { SpiritArt, useSpiritPose } from "./spirit";

/** Responsive welcome header: original ANSI mascot and a text column, without usage tips. */
export function Logo({
  locale = "zh",
  model,
  cwd,
  thinking,
  working = false,
}: {
  locale?: Locale;
  model: string;
  cwd: string;
  thinking?: ThinkingLevel;
  working?: boolean;
}) {
  const t = createTuiI18n(locale);
  const theme = useTheme();
  const { columns, rows: terminalRows } = useTerminalSize();
  const showArt = columns >= 76 && terminalRows >= 20;
  const showBigTitle = columns >= 34 && terminalRows >= 18;
  const pose = useSpiritPose(showArt, working);
  const rows = renderBigText("NEANT", theme.logoFrom, theme.logoTo);
  return (
    <Box flexDirection="row" width={columns} gap={showArt ? 2 : 0}>
      {showArt && <SpiritArt pose={pose} />}
      <Box flexDirection="column" flexGrow={1} paddingTop={showArt ? 2 : 0}>
        <ThemedText color="accent" bold wrap="truncate">
          Neant
        </ThemedText>
        {showBigTitle && (
          <>
            {rows.map((row, y) => (
              <ThemedText key={y} wrap="truncate" preserveWhitespace>
                {mergeColoredCells(row).map((segment, x) => (
                  <ThemedText key={x} color={segment.color}>
                    {segment.text}
                  </ThemedText>
                ))}
              </ThemedText>
            ))}
            <Box height={1} />
          </>
        )}
        <ThemedText wrap="truncate">
          {model}
          {thinking !== undefined && (
            <ThemedText color="subtle">{` · ${t(`logo.effort.${thinking}`)}`}</ThemedText>
          )}
        </ThemedText>
        <ThemedText color="subtle" wrap="truncate">
          {cwd}
        </ThemedText>
      </Box>
    </Box>
  );
}
