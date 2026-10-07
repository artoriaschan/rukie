import type { Locale } from "@rukie/i18n";
import { createTuiI18n } from "../../../view/i18n";
import {
  Box,
  Image,
  ThemedText,
  useTerminalGraphics,
  useTerminalSize,
  useTheme,
} from "../../../ink/index.ts";
import type { ThinkingLevel } from "@rukie/shared";
import { mergeColoredCells, renderBigText } from "./bigfont";
import { AvatarArt, useAvatarPose } from "./avatar";
import { useAvatarPortrait } from "./avatar-portrait";
import { AVATAR_HEIGHT, AVATAR_WIDTH } from "./avatar-frames";

/** Responsive welcome header: full-resolution portrait with character-art fallback. */
export function Logo({
  locale = "zh",
  model,
  cwd,
  thinking,
  working = false,
  suspended = false,
}: {
  locale?: Locale;
  model: string;
  cwd: string;
  thinking?: ThinkingLevel;
  working?: boolean;
  /** Raster placements must yield to an image preview over the transcript. */
  suspended?: boolean;
}) {
  const t = createTuiI18n(locale);
  const theme = useTheme();
  const { columns, rows: terminalRows } = useTerminalSize();
  const graphics = useTerminalGraphics();
  const showArt = columns >= 76 && terminalRows >= 20;
  const showBigTitle = columns >= 34 && terminalRows >= 18;
  const portrait = useAvatarPortrait(showArt && graphics.supported);
  const pose = useAvatarPose(showArt && !portrait && !suspended, working);
  const rows = renderBigText("RUKIE", theme.logoFrom, theme.logoTo);
  return (
    <Box flexDirection="row" width={columns} gap={showArt ? 2 : 0}>
      {showArt &&
        (portrait && suspended ? (
          <Box width={AVATAR_WIDTH} height={AVATAR_HEIGHT} flexShrink={0} />
        ) : portrait ? (
          <Image
            {...portrait}
            mimeType="image/png"
            width={AVATAR_WIDTH}
            height={AVATAR_HEIGHT}
            flexShrink={0}
          />
        ) : (
          <AvatarArt pose={pose} />
        ))}
      <Box flexDirection="column" flexGrow={1} paddingTop={showArt ? 2 : 0}>
        <ThemedText color="accent" bold wrap="truncate">
          Rukie
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
