import type { JobView } from "@rukie/shared";
import { fmtDuration, type Locale } from "@rukie/i18n";
import { useState } from "react";
import { Box, ThemedText, useAnimationFrame } from "../../../ink/index.ts";
import { createTuiI18n } from "../../../view/i18n";

import { jobCardRows } from "../../../view/transcript/job-card";
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
  const glyph = live ? "●" : job.status === "completed" ? "✓" : "✗";
  const duration = fmtDuration(Math.max(0, (job.endedAt ?? Date.now()) - job.startedAt), locale);
  const color = live ? "warning" : job.status === "completed" ? "success" : "error";
  // Wrap before taking the fixed waterfall: a long output line shows its tail.
  const rows = jobCardRows(job, output, contentColumns, locale, expanded || commandOpen);
  const commandRows = rows.slice(1, -2);
  const railRows = 3 + commandRows.length + (dropped ? 1 : 0);
  return (
    <Box>
      {groupPosition && (
        <ThemedText color="inactive" selectable={false}>
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
          <ThemedText wrap="truncate">
            <ThemedText color={hovered ? "accent" : color}>{glyph}</ThemedText>{" "}
            <ThemedText bold color={hovered ? "accent" : undefined}>
              {t("jobs.card.prefix")}
              {job.id}
            </ThemedText>{" "}
            <ThemedText dimColor>{job.kind}</ThemedText>{" "}
            <ThemedText dimColor>{duration}</ThemedText>{" "}
            <ThemedText color={color}>{t(`jobs.status.${job.status}`)}</ThemedText>
          </ThemedText>
        </Box>
        <Box flexDirection="column" onClick={() => setCommandOpen((open) => !open)}>
          {commandRows.map((line, index) => (
            <ThemedText key={index} wrap="truncate">
              <ThemedText color="accent" selectable={false}>
                │
              </ThemedText>
              <ThemedText dimColor>{line.slice(1)}</ThemedText>
            </ThemedText>
          ))}
        </Box>
        {dropped && (
          <ThemedText color="warning" wrap="truncate">
            {t("jobs.panel.dropped")}
          </ThemedText>
        )}
        {Array.from({ length: 2 }, (_, index) => (
          <ThemedText key={index} wrap="truncate">
            <ThemedText color="success" selectable={false}>
              │
            </ThemedText>
            <ThemedText dimColor>{rows[rows.length - 2 + index]?.slice(1)}</ThemedText>
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
