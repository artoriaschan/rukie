import type { JobView } from "@neant/shared";
import { fmtDuration, type Locale } from "@neant/i18n";
import { useState } from "react";
import { Box, ThemedText, useAnimationFrame } from "@neant/tui";
import { createTuiI18n } from "../../i18n";

import { cleanJobText, jobOutputRows } from "./output";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function clipRow(source: string, columns: number): string {
  let text = "";
  let width = 0;
  for (const { segment } of graphemes.segment(source)) {
    const size = Bun.stringWidth(segment);
    if (width + size > columns) break;
    text += segment;
    width += size;
  }
  return text;
}

export function jobCardRows(
  job: JobView,
  output: string,
  columns: number,
  locale: Locale,
  commandExpanded = false,
): string[] {
  const t = createTuiI18n(locale);
  const live = job.status === "running" || job.status === "stopping";
  const glyph = live ? "●" : job.status === "completed" ? "✓" : "✗";
  const rows = jobOutputRows(output, Math.max(1, columns - 6));
  return [
    `${glyph} ${job.id} · ${t(`jobs.status.${job.status}`)} · ${fmtDuration(Math.max(0, (job.endedAt ?? Date.now()) - job.startedAt), locale)}`,
    ...(commandExpanded
      ? jobOutputRows(`❯ ${job.command}`, Math.max(1, columns - 4), Infinity)
      : [`❯ ${cleanJobText(job.command).split("\n")[0] ?? ""}`]),
    ...Array.from({ length: 2 }, (_, index) => `  │ ${rows[index] ?? ""}`),
  ].map((row) => clipRow(row, Math.max(0, columns - 2)));
}

export function JobCard({
  job,
  output,
  columns,
  locale = "zh",
  onOpen,
  dropped = false,
  groupPosition,
  expanded = false,
}: {
  job: JobView;
  output: string;
  columns: number;
  locale?: Locale;
  onOpen?(id: string): void;
  dropped?: boolean;
  groupPosition?: "first" | "middle" | "last";
  expanded?: boolean;
}) {
  const live = job.status === "running" || job.status === "stopping";
  useAnimationFrame(live ? 1000 : null);
  const contentColumns = groupPosition ? Math.max(1, columns - 1) : columns;
  const [commandOpen, setCommandOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const t = createTuiI18n(locale);
  const color = live ? "warning" : job.status === "completed" ? "success" : "error";
  // Wrap before taking the fixed waterfall: a long output line shows its tail.
  const rows = jobCardRows(job, output, contentColumns, locale, expanded || commandOpen);
  const commandRows = rows.slice(1, -2);
  const railRows = 3 + commandRows.length + (dropped ? 1 : 0);
  return (
    <Box>
      {groupPosition && (
        <ThemedText color="inactive">
          {Array.from({ length: railRows }, (_, index) =>
            index === 0 && groupPosition === "first"
              ? "╭"
              : index === railRows - 1 && groupPosition === "last"
                ? "╰"
                : "│",
          ).join("\n")}
        </ThemedText>
      )}
      <Box
        flexDirection="column"
        width={contentColumns}
        paddingLeft={2}
        scrollAnchorId={`job-${job.id}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Box
          width={Bun.stringWidth(rows[0] ?? "")}
          onClick={onOpen ? () => onOpen(job.id) : undefined}
        >
          <ThemedText color={hovered ? "accent" : color} wrap="truncate">
            {rows[0]}
          </ThemedText>
        </Box>
        <Box flexDirection="column" onClick={() => setCommandOpen((open) => !open)}>
          {commandRows.map((line, index) => (
            <ThemedText key={index} wrap="truncate">
              {line}
            </ThemedText>
          ))}
        </Box>
        {dropped && (
          <ThemedText color="warning" wrap="truncate">
            {t("jobs.panel.dropped")}
          </ThemedText>
        )}
        {Array.from({ length: 2 }, (_, index) => (
          <ThemedText key={index} dimColor wrap="truncate">
            {rows[rows.length - 2 + index]}
          </ThemedText>
        ))}
      </Box>
    </Box>
  );
}

export function JobGroupHeader({
  jobs,
  folded,
  columns,
  locale = "zh",
  onToggle,
}: {
  jobs: readonly JobView[];
  folded: boolean;
  columns: number;
  locale?: Locale;
  onToggle(): void;
}) {
  const t = createTuiI18n(locale);
  const [hovered, setHovered] = useState(false);
  const live = jobs.some((job) => job.status === "running" || job.status === "stopping");
  useAnimationFrame(live ? 1000 : null);
  const duration = fmtDuration(
    Math.max(
      0,
      (live ? Date.now() : Math.max(...jobs.map((job) => job.endedAt ?? job.startedAt))) -
        Math.min(...jobs.map((job) => job.startedAt)),
    ),
    locale,
  );
  const statuses = ["running", "stopping", "failed", "killed", "completed"] as const;
  const separator = columns < 60 ? "·" : " · ";
  return (
    <Box
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ThemedText wrap="truncate">
        <ThemedText
          dimColor={!hovered}
          color={hovered ? "accent" : undefined}
        >{`${folded ? "▸" : "▾"} ${t(folded ? "jobs.group.folded" : "jobs.group.title", { count: jobs.length })}`}</ThemedText>
        {statuses.map((status) => {
          const count = jobs.filter((job) => job.status === status).length;
          return count ? (
            <ThemedText
              key={status}
              color={
                status === "failed" || status === "killed"
                  ? "error"
                  : status === "completed"
                    ? "success"
                    : "warning"
              }
            >
              {`${separator}${count} ${t(`jobs.status.${status}`)}`}
            </ThemedText>
          ) : null;
        })}
        <ThemedText dimColor>{`${separator}${duration}`}</ThemedText>
        {folded && <ThemedText dimColor>{`${separator}${t("jobs.group.hint")}`}</ThemedText>}
      </ThemedText>
    </Box>
  );
}
