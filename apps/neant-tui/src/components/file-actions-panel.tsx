import type { Locale } from "@neant/i18n";
import { ThemedBox, ThemedText } from "@neant/tui";
import { createTuiI18n } from "../i18n";

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
  return (
    <ThemedBox
      position="absolute"
      top={0}
      left={0}
      width={columns}
      height={rows}
      flexDirection="column"
      paddingX={columns >= 8 ? 2 : 0}
      backgroundColor="inverseText"
      onClick={() => {}}
    >
      {titleRows > 0 && (
        <ThemedText color="remember" bold wrap="truncate">
          {t("file-actions.title")}
        </ThemedText>
      )}
      {titleRows > 1 && (
        <ThemedText dimColor wrap="truncate">
          {Bun.stripANSI(path).replace(/[\r\n\t]/g, " ")}
        </ThemedText>
      )}
      {[
        directory ? "file-actions.open-folder" : "file-actions.open",
        "file-actions.reveal",
        "file-actions.copy",
      ]
        .slice(start, start + count)
        .map((key, offset) => {
          const index = start + offset;
          return (
            <ThemedBox key={key} height={1} onClick={() => onPick(index)}>
              <ThemedText
                color={focus === index ? "accent" : undefined}
                bold={focus === index}
                wrap="truncate"
              >
                {`${focus === index ? "❯" : " "} ${index + 1} ${t(key as "file-actions.open" | "file-actions.open-folder" | "file-actions.reveal" | "file-actions.copy")}`}
              </ThemedText>
            </ThemedBox>
          );
        })}
      {rows > titleRows + count && (
        <ThemedText dimColor wrap="truncate">
          {t("file-actions.hint")}
        </ThemedText>
      )}
    </ThemedBox>
  );
}
