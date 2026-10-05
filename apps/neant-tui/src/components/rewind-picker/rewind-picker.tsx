import { Box, Divider, ListItem, ThemedText } from "@neant/tui";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";

export interface RewindEntry {
  promptEntryId: string;
  preview: string;
  files: readonly { path: string; backup: string | null }[];
}
export interface RewindMode {
  code: boolean;
  conversation: boolean;
}

/** Display-only adaptation of dsh-TUI RewindPicker; the screen owns all decisions. */
export function RewindPicker({
  entries,
  focus,
  confirm,
  modes,
  mode,
  files,
  maxHeight,
  columns,
  locale,
  busy,
  onFocus,
  onMode,
}: {
  entries: readonly RewindEntry[];
  focus: number;
  confirm: boolean;
  modes: readonly RewindMode[];
  mode: number;
  files: readonly { path: string; backup: string | null }[];
  maxHeight: number;
  columns: number;
  locale: Locale;
  busy: boolean;
  onFocus(index: number): void;
  onMode(index: number): void;
}) {
  const t = createTuiI18n(locale);
  const gap = Number(maxHeight >= 9);
  const entry = entries[focus]!;
  const preview = (value: string) => {
    const chars = Array.from(value.replace(/\s+/g, " ").trim());
    return chars.length > 80 ? chars.slice(0, 80).join("") + "…" : chars.join("");
  };
  const description = (index: number) =>
    [
      ...(index === 0 ? [t("rewind.last")] : []),
      ...(entries[index]!.files.length
        ? [t("rewind.changed", { count: entries[index]!.files.length })]
        : []),
    ].join(" · ");
  const contentWidth = columns - (maxHeight < 9 ? 2 : 4);
  const hasFiles = files.length > 0;
  const inlinePreview = confirm && maxHeight < 7;
  const frameRows = inlinePreview ? 3 : 4;
  // Reserve the same rows across modes so arrow navigation never moves the prompt or footer.
  const fileRows =
    confirm && hasFiles ? Math.max(1, Math.min(files.length, maxHeight - gap - frameRows - 3)) : 0;
  const modeRows = Math.max(
    1,
    Math.min(modes.length, maxHeight - gap - frameRows - Number(hasFiles) - fileRows),
  );
  const heights = confirm
    ? modes.map(() => 1)
    : entries.map((_, i) => 1 + Number(!!description(i)));
  const budget = confirm ? modeRows : maxHeight - gap - 4;
  // Grow a contiguous window around focus using actual display row costs.
  let start = confirm ? mode : focus;
  let end = start + 1;
  let used = heights[start]!;
  while (true) {
    if (start > 0 && used + heights[start - 1]! <= budget) {
      used += heights[--start]!;
    } else if (end < heights.length && used + heights[end]! <= budget) {
      used += heights[end++]!;
    } else break;
  }
  const showFiles = confirm && !!modes[mode]?.code;
  const shownFiles = files.slice(
    0,
    files.length > fileRows && fileRows > 1 ? fileRows - 1 : fileRows,
  );
  return (
    <Box flexDirection="column" height={maxHeight} flexShrink={0} paddingTop={gap}>
      <Divider color="permission" />
      <Box flexDirection="column" paddingX={maxHeight < 9 ? 1 : 2} flexGrow={1}>
        <ThemedText bold color="accent" wrap="truncate">
          {t(confirm ? "rewind.confirm" : "rewind.title")}
          {inlinePreview ? ` ${preview(entry.preview)}` : ""}
        </ThemedText>
        {!inlinePreview && (
          <ThemedText dimColor wrap="truncate">
            {confirm ? preview(entry.preview) : t("rewind.subtitle")}
          </ThemedText>
        )}
        <Box flexDirection="column" flexGrow={1}>
          {confirm
            ? modes.slice(start, end).map((choice, index) => {
                const absolute = start + index;
                return (
                  <Box
                    key={absolute}
                    onClick={() => {
                      if (!busy) onMode(absolute);
                    }}
                  >
                    <ListItem
                      width={contentWidth}
                      focused={absolute === mode}
                      singleLine
                      showScrollUp={absolute === start && start > 0}
                      showScrollDown={absolute === end - 1 && end < modes.length}
                    >
                      {t(
                        choice.code
                          ? choice.conversation
                            ? "rewind.both"
                            : "rewind.code"
                          : "rewind.conversation",
                      )}
                    </ListItem>
                  </Box>
                );
              })
            : entries.slice(start, end).map((row, index) => {
                const absolute = start + index;
                return (
                  <Box
                    key={row.promptEntryId}
                    flexDirection="column"
                    onClick={() => onFocus(absolute)}
                  >
                    <ListItem
                      width={contentWidth}
                      focused={absolute === focus}
                      singleLine
                      showScrollUp={absolute === start && start > 0}
                      showScrollDown={absolute === end - 1 && end < entries.length}
                    >
                      {preview(row.preview)}
                    </ListItem>
                    {description(absolute) && (
                      <Box paddingLeft={2}>
                        <ThemedText dimColor wrap="truncate">
                          {description(absolute)}
                        </ThemedText>
                      </Box>
                    )}
                  </Box>
                );
              })}
        </Box>
        {confirm && hasFiles && (
          <Box flexDirection="column" height={fileRows + 1} flexShrink={0}>
            {showFiles && (
              <>
                {shownFiles.map((file) => (
                  <Box key={file.path} height={1}>
                    <Box
                      width={
                        contentWidth -
                        (fileRows === 1 && files.length > 1
                          ? Bun.stringWidth(` · ${t("rewind.more", { count: files.length - 1 })}`)
                          : 0)
                      }
                    >
                      <ThemedText dimColor wrap="truncate">
                        {t(file.backup === null ? "rewind.delete" : "rewind.restore", {
                          path: file.path,
                        })}
                      </ThemedText>
                    </Box>
                    {fileRows === 1 && files.length > 1 && (
                      <ThemedText
                        dimColor
                        wrap="truncate"
                      >{` · ${t("rewind.more", { count: files.length - 1 })}`}</ThemedText>
                    )}
                  </Box>
                ))}
                {fileRows > 1 && files.length > shownFiles.length && (
                  <ThemedText dimColor wrap="truncate">
                    {t("rewind.more", { count: files.length - shownFiles.length })}
                  </ThemedText>
                )}
                <ThemedText dimColor wrap="truncate">
                  {t("rewind.bash")}
                </ThemedText>
              </>
            )}
          </Box>
        )}
        <ThemedText dimColor italic wrap="truncate">
          {t(confirm ? "rewind.confirm-hint" : "rewind.hint")}
        </ThemedText>
      </Box>
    </Box>
  );
}
