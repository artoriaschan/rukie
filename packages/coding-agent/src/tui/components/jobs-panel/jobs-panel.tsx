import type { Ref } from "react";
import { useLayoutEffect } from "react";
import { fmtDuration, type Locale } from "@neant/i18n";
import type { JobView } from "@neant/shared";
import {
  Box,
  Divider,
  ScrollBox,
  ThemedText,
  type ScrollHandle,
  type ScrollSnapshot,
} from "../../../ink/index.ts";
import { createTuiI18n } from "../../../view/i18n";
import { cleanJobText, jobOutputRows } from "../job-card/output";

type PanelJob = JobView & { output: string; dropped: boolean; promotedAt?: number };

export function JobsPanel({
  rows,
  columns,
  locale,
  jobs,
  focusIndex,
  expanded,
  armed,
  scrollRef,
  initialScroll,
  onSelect,
}: {
  rows: number;
  columns: number;
  locale: Locale;
  jobs: readonly PanelJob[];
  focusIndex: number;
  expanded: ReadonlySet<string>;
  armed?: string;
  scrollRef: Ref<ScrollHandle>;
  initialScroll?: ScrollSnapshot;
  onSelect(index: number): void;
}) {
  const t = createTuiI18n(locale);
  const width = Math.max(1, columns - 2);
  const outputLimit = Math.max(1, Math.min(8, rows - 13));
  const time = (timestamp: number) =>
    new Date(timestamp)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, " UTC");
  const detailRows = (job: PanelJob) => [
    `❯ ${cleanJobText(job.command).replace(/\n/g, " ")}`,
    `${t("jobs.panel.started")} · ${time(job.startedAt)}`,
    ...(job.promotedAt ? [`${t("jobs.panel.promoted")} · ${time(job.promotedAt)}`] : []),
    ...(job.endedAt
      ? [
          `${t("jobs.panel.settled")} · ${time(job.endedAt)}${job.exitCode === undefined ? "" : ` · ${t("jobs.panel.exit-code", { code: job.exitCode })}`}`,
        ]
      : []),
    ...(job.signal ? [t("jobs.panel.signal", { signal: cleanJobText(job.signal) })] : []),
    ...(job.spillPath
      ? jobOutputRows(t("jobs.panel.spill", { path: cleanJobText(job.spillPath) }), width, Infinity)
      : []),
    ...(job.dropped ? [t("jobs.panel.dropped")] : []),
    t("jobs.panel.output"),
    ...jobOutputRows(job.output, Math.max(1, width - 2), outputLimit).map((line) => `│ ${line}`),
  ];
  const tops: number[] = [];
  let total = 0;
  const details = jobs.map((job) => (expanded.has(job.id) ? detailRows(job) : []));
  for (let index = 0; index < jobs.length; index++) {
    tops.push(total);
    total += 1 + details[index]!.length;
  }
  const focusedTop = tops[focusIndex] ?? 0;
  useLayoutEffect(() => {
    if (!scrollRef || typeof scrollRef !== "object" || !scrollRef.current) return;
    const scroll = scrollRef.current;
    const snapshot = scroll.getSnapshot();
    // Initial layout restores focusedTop; scrolling an unmeasured viewport
    // would turn the initial reading state into bottom follow.
    if (snapshot.height === 0) return;
    if (focusedTop < snapshot.top) scroll.scrollBy(focusedTop - snapshot.top);
    else if (focusedTop >= snapshot.top + snapshot.height)
      scroll.scrollBy(focusedTop - snapshot.top - snapshot.height + 1);
  }, [focusIndex, expanded, focusedTop, rows, columns]);
  const live = jobs.filter((job) => job.status === "running" || job.status === "stopping").length;
  const complete = jobs.filter((job) => job.status === "completed").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const killed = jobs.filter((job) => job.status === "killed").length;
  return (
    <Box height={rows} flexDirection="column" paddingX={1}>
      <Divider title={t("jobs.panel.title")} />
      <ThemedText
        dimColor
        wrap="truncate"
      >{`${live} ${t("jobs.status.running")} · ${complete} ${t("jobs.status.completed")} · ${failed} ${t("jobs.status.failed")} · ${killed} ${t("jobs.status.killed")}`}</ThemedText>
      <ScrollBox
        initialTop={initialScroll?.top ?? focusedTop}
        initialAnchor={initialScroll?.anchor}
        initialFollow={initialScroll?.following ?? false}
        key={[...expanded].join(",")}
        ref={scrollRef}
      >
        {jobs.length === 0 ? (
          <ThemedText>{t("jobs.panel.empty")}</ThemedText>
        ) : (
          jobs.map((job, index) => (
            <Box key={job.id} flexDirection="column" onClick={() => onSelect(index)}>
              <ThemedText
                color={
                  index === focusIndex
                    ? "accent"
                    : job.status === "failed" || job.status === "killed"
                      ? "error"
                      : undefined
                }
                wrap="truncate"
              >{`${index === focusIndex ? "❯" : " "} ${job.id} · ${t(`jobs.status.${job.status}`)} · ${fmtDuration(Math.max(0, (job.endedAt ?? Date.now()) - job.startedAt), locale)} · ${cleanJobText(job.label).replace(/\n/g, " ")}`}</ThemedText>
              {details[index]!.map((line, at) => (
                <ThemedText key={at} dimColor wrap="truncate">
                  {line}
                </ThemedText>
              ))}
            </Box>
          ))
        )}
      </ScrollBox>
      <ThemedText color="warning" wrap="truncate">
        {armed ? t("jobs.panel.confirm", { id: armed }) : ""}
      </ThemedText>
      <ThemedText dimColor wrap="truncate">
        {t("jobs.panel.hint")}
      </ThemedText>
    </Box>
  );
}
