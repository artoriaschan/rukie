import type { JobView } from "@neant/shared";
import type { Locale } from "@neant/i18n";
import { Box, ThemedText } from "@neant/tui";
import { createTuiI18n } from "../../i18n";

import { cleanJobText, jobOutputRows } from "./output";

export function JobCard({
  job,
  output,
  columns,
  locale = "zh",
  onOpen,
}: {
  job: JobView;
  output: string;
  columns: number;
  locale?: Locale;
  onOpen?(id: string): void;
}) {
  const t = createTuiI18n(locale);
  const live = job.status === "running" || job.status === "stopping";
  const color = live ? "warning" : job.status === "completed" ? "success" : "error";
  const glyph = live ? "●" : job.status === "completed" ? "✓" : "✗";
  // Wrap before taking the fixed waterfall: a long output line shows its tail.
  const rows = jobOutputRows(output, Math.max(1, columns - 6));
  return (
    <Box
      flexDirection="column"
      width={columns}
      paddingLeft={2}
      onClick={onOpen ? () => onOpen(job.id) : undefined}
    >
      <ThemedText color={color} wrap="truncate">
        {`${glyph} ${job.id} · ${t(`jobs.status.${job.status}`)}`}
      </ThemedText>
      <ThemedText wrap="truncate">{`❯ ${cleanJobText(job.command).replace(/\n/g, " ")}`}</ThemedText>
      {Array.from({ length: 2 }, (_, index) => (
        <ThemedText key={index} dimColor wrap="truncate">{`  │ ${rows[index] ?? ""}`}</ThemedText>
      ))}
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
  const statuses = ["running", "stopping", "failed", "killed", "completed"] as const;
  const separator = columns < 60 ? "·" : " · ";
  return (
    <Box onClick={onToggle}>
      <ThemedText wrap="truncate">
        <ThemedText
          dimColor
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
        {folded && <ThemedText dimColor>{`${separator}${t("jobs.group.hint")}`}</ThemedText>}
      </ThemedText>
    </Box>
  );
}
