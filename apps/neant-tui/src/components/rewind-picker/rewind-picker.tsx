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

/** Content-sized flow pane. The screen supplies the space shared with persistent panels. */
export function rewindLayout(
  entries: readonly RewindEntry[],
  confirm: boolean,
  modeCount: number,
  fileCount: number,
  maxHeight: number,
) {
  const spacious = maxHeight >= 9;
  const top = spacious ? 2 : 0; // Chat margin + Pane padding, as in dsh-TUI.
  const headerRows = confirm ? 1 : 2;
  const headerGap = Number(spacious);
  const frame = top + 1 + headerRows + headerGap + 1;
  const fileRows =
    confirm && fileCount ? Math.max(1, Math.min(fileCount, maxHeight - frame - modeCount - 1)) : 0;
  const budget = Math.max(1, maxHeight - frame - (fileRows ? fileRows + 1 : 0));
  const plain = confirm && fileCount === 0;
  const costs = plain
    ? [2]
    : confirm
      ? Array.from({ length: modeCount }, () => 1)
      : entries.map((entry, index) => 1 + Number(index === 0 || entry.files.length > 0));
  const listRows = Math.min(
    costs.reduce((sum, cost) => sum + cost, 0),
    budget,
  );
  return {
    top,
    headerGap,
    fileRows,
    listRows,
    costs,
    plain,
    height: frame + listRows + (fileRows ? fileRows + 1 : 0),
  };
}

/** Balanced display-row window, following dsh-TUI listWindow's focus-centered behavior. */
function focusWindow(costs: readonly number[], focus: number, budget: number) {
  let start = focus;
  let end = focus + 1;
  let upRows = 0;
  let downRows = 0;
  while (true) {
    const used = costs[focus]! + upRows + downRows;
    const up = start > 0 ? costs[start - 1]! : Infinity;
    const down = end < costs.length ? costs[end]! : Infinity;
    const canUp = used + up <= budget;
    const canDown = used + down <= budget;
    if (!canUp && !canDown) return { start, end };
    if (canUp && (!canDown || upRows <= downRows)) upRows += costs[--start]!;
    else downRows += costs[end++]!;
  }
}

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
  const layout = rewindLayout(entries, confirm, modes.length, files.length, maxHeight);
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
  const padding = maxHeight < 9 ? 1 : 2;
  const contentWidth = columns - padding * 2;
  const { start, end } = focusWindow(layout.costs, confirm ? mode : focus, layout.listRows);
  const showFiles = confirm && !!modes[mode]?.code;
  const shownFiles = files.slice(
    0,
    files.length > layout.fileRows && layout.fileRows > 1 ? layout.fileRows - 1 : layout.fileRows,
  );
  return (
    <Box flexDirection="column" flexShrink={0} paddingTop={layout.top}>
      <Divider color="permission" />
      <Box flexDirection="column" paddingX={padding}>
        <Box flexDirection={confirm ? "row" : "column"} marginBottom={layout.headerGap}>
          <ThemedText bold color="remember" wrap="truncate">
            {t(confirm ? "rewind.confirm" : "rewind.title")}
          </ThemedText>
          {!layout.plain && (
            <Box flexShrink={1}>
              <ThemedText dimColor wrap="truncate">
                {confirm ? ` ${preview(entry.preview)}` : t("rewind.subtitle")}
              </ThemedText>
            </Box>
          )}
        </Box>
        <Box flexDirection="column" height={layout.listRows} flexShrink={0}>
          {layout.plain ? (
            <ListItem
              picker
              width={contentWidth}
              singleLine
              description={t("rewind.confirm-desc")}
              onClick={busy ? undefined : () => onMode(0)}
            >
              {preview(entry.preview)}
            </ListItem>
          ) : confirm ? (
            modes.slice(start, end).map((choice, index) => {
              const absolute = start + index;
              return (
                <ListItem
                  key={absolute}
                  picker
                  width={contentWidth}
                  focused={absolute === mode}
                  singleLine
                  showScrollUp={absolute === start && start > 0}
                  showScrollDown={absolute === end - 1 && end < modes.length}
                  onClick={busy ? undefined : () => onMode(absolute)}
                >
                  {t(
                    choice.code
                      ? choice.conversation
                        ? "rewind.both"
                        : "rewind.code"
                      : "rewind.conversation",
                  )}
                </ListItem>
              );
            })
          ) : (
            entries.slice(start, end).map((row, index) => {
              const absolute = start + index;
              return (
                <ListItem
                  key={row.promptEntryId}
                  picker
                  width={contentWidth}
                  focused={absolute === focus}
                  singleLine
                  description={description(absolute)}
                  showScrollUp={absolute === start && start > 0}
                  showScrollDown={absolute === end - 1 && end < entries.length}
                  onClick={busy ? undefined : () => onFocus(absolute)}
                >
                  {preview(row.preview)}
                </ListItem>
              );
            })
          )}
        </Box>
        {confirm && layout.fileRows > 0 && (
          <Box flexDirection="column" height={layout.fileRows + 1} flexShrink={0}>
            {showFiles && (
              <>
                {shownFiles.map((file) => (
                  <Box key={file.path} height={1}>
                    <Box
                      width={
                        contentWidth -
                        (layout.fileRows === 1 && files.length > 1
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
                    {layout.fileRows === 1 && files.length > 1 && (
                      <ThemedText
                        dimColor
                        wrap="truncate"
                      >{` · ${t("rewind.more", { count: files.length - 1 })}`}</ThemedText>
                    )}
                  </Box>
                ))}
                {layout.fileRows > 1 && files.length > shownFiles.length && (
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
