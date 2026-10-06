import type { JobView } from "@neant/shared";
import type { Locale } from "@neant/i18n";
import { Box, ThemedText } from "@neant/tui";
import { createTuiI18n } from "../../i18n";

function clean(text: string) {
  return (
    Bun.stripANSI(text)
      .replace(/\r\n?/g, "\n")
      // oxlint-disable-next-line no-control-regex -- job output cannot inject terminal controls
      .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, " ")
  );
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function visualRows(text: string, columns: number) {
  const rows: string[] = [];
  // Match the renderer: Bun supplies word boundaries, then hard-wrap whole
  // graphemes so long log lines cannot clip their final two visual rows.
  for (const line of Bun.wrapAnsi(clean(text).replace(/\n$/, ""), columns).split("\n")) {
    let row = "";
    let width = 0;
    for (const { segment } of graphemes.segment(line)) {
      const size = Bun.stringWidth(segment);
      if (size <= 0 || size > columns) continue;
      if (width + size > columns) {
        rows.push(row);
        row = "";
        width = 0;
      }
      row += segment;
      width += size;
    }
    rows.push(row);
  }
  return rows.slice(-2);
}

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
  const rows = visualRows(output, Math.max(1, columns - 6));
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
      <ThemedText wrap="truncate">{`❯ ${clean(job.command).replace(/\n/g, " ")}`}</ThemedText>
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
