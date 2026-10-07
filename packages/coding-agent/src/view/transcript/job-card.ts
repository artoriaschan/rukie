import type { JobView } from "@rukie/shared";
import { fmtDuration, type Locale } from "@rukie/i18n";
import { createTuiI18n } from "../i18n";
import { cleanJobText, jobOutputRows } from "./job-output";

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
    `${glyph} ${t("jobs.card.prefix")}${job.id} ${job.kind} ${fmtDuration(Math.max(0, (job.endedAt ?? Date.now()) - job.startedAt), locale)} ${t(`jobs.status.${job.status}`)}`,
    ...(commandExpanded
      ? jobOutputRows(`❯ ${job.command}`, Math.max(1, columns - 4), Infinity).map(
          (line) => `│ ${line}`,
        )
      : [`│ ❯ ${cleanJobText(job.command).split("\n")[0] ?? ""}`]),
    ...Array.from({ length: 2 }, (_, index) => `│ ${index === 0 ? "≡ " : ""}${rows[index] ?? ""}`),
  ].map((row) => clipRow(row, Math.max(0, columns - 2)));
}
