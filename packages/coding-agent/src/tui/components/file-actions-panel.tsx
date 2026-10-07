import type { Locale } from "@rukie/i18n";
import { ThemedBox, ThemedText } from "../../ink/index.ts";
import { createTuiI18n } from "../../view/i18n";

export function FileActionsPanel({
  path,
  directory,
  focus,
  columns,
  rows,
  locale,
  onPick,
}: {
  path: string;
  directory: boolean;
  focus: number;
  columns: number;
  rows: number;
  locale: Locale;
  onPick(index: number): void;
}) {
  const t = createTuiI18n(locale);
  const titleRows = rows >= 5 ? 2 : rows >= 4 ? 1 : 0;
  const count = Math.max(1, Math.min(3, rows - titleRows));
  const start = Math.min(3 - count, Math.max(0, focus - count + 1));
  const actions = [
    directory ? "file-actions.open-folder" : "file-actions.open",
    "file-actions.reveal",
    "file-actions.copy",
  ] as const;
  // Reserve the marker and action number before spending space on side padding.
  const labelWidth = Math.max(...actions.map((key) => Bun.stringWidth(t(key))));
  const paddingX = Math.max(0, Math.min(2, Math.floor((columns - labelWidth - 4) / 2)));
  return (
    <ThemedBox
      flexShrink={0}
      position="absolute"
      top={0}
      left={0}
      width={columns}
      height={rows}
      flexDirection="column"
      paddingX={paddingX}
      backgroundColor="inverseText"
      onClick={() => {}}
    >
      {titleRows > 0 && (
        <ThemedText color="remember" bold wrap="truncate">
          {t("file-actions.title")}
        </ThemedText>
      )}
      {titleRows > 1 && (
        <ThemedText dim wrap="truncate">
          {Bun.stripANSI(path).replace(/[\r\n\t]/g, " ")}
        </ThemedText>
      )}
      {actions.slice(start, start + count).map((key, offset) => {
        const index = start + offset;
        return (
          <ThemedBox flexShrink={0} key={key} height={1} onClick={() => onPick(index)}>
            <ThemedText
              color={focus === index ? "accent" : undefined}
              bold={focus === index}
              wrap="truncate"
            >
              {`${focus === index ? "❯" : " "} ${index + 1} ${t(key)}`}
            </ThemedText>
          </ThemedBox>
        );
      })}
      {rows > titleRows + count && (
        <ThemedText dim wrap="truncate">
          {t("file-actions.hint")}
        </ThemedText>
      )}
    </ThemedBox>
  );
}
