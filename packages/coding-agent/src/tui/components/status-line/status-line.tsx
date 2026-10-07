import type { GoalView } from "@rukie/agent";
import { useState, type ReactNode } from "react";
import { basename } from "node:path";
import { Box, ThemedText, textLines, type ThemeColor } from "../../../ink/index.ts";
import type {
  JobView,
  ContextUsageEvent,
  PermissionMode,
  RunResult,
  ThinkingLevel,
} from "@rukie/shared";
import { goalPhasePresentation } from "../goal-phase";
import {
  allocateColumns,
  barWidths,
  count,
  gauge,
  percentage,
  pressure,
  segments as contextSegments,
  sparkline,
  speedColor,
} from "../../../view/transcript/metrics";

import type { TpsSample } from "../../../view/transcript/metrics";
export type { TpsSample } from "../../../view/transcript/metrics";
export interface StatusLineProps {
  locale?: Locale;
  columns: number;
  mode: PermissionMode;
  planMode?: boolean;
  jobs?: readonly JobView[];
  goal?: GoalView;
  showContextBar?: boolean;
  model: string;
  provider: string;
  contextUsage?: ContextUsageEvent;
  thinking?: ThinkingLevel;
  tps: number;
  tpsSamples: readonly TpsSample[];
  /** Current time in milliseconds, supplied by the frontend for the 60-second average. */
  now: number;
  usage: Pick<RunResult["usage"], "input" | "output" | "cacheRead" | "cacheWrite">;
  gitBranch?: string;
  cwd: string;
  working: boolean;
}

type HoverField =
  | "jobs"
  | "bar"
  | "ctx"
  | "mode"
  | "model"
  | "tps"
  | "cache"
  | "tokens"
  | "git"
  | "cwd";

function Meter({
  value,
  width,
  color,
}: {
  value: number;
  width: number;
  color: "success" | "warning" | "error";
}) {
  const { fill, track } = gauge(value, Math.max(0, width - 2));
  return (
    <ThemedText>
      <ThemedText color={color}>▕{fill}</ThemedText>
      <ThemedText color="subtle">{track}▏</ThemedText>
    </ThemedText>
  );
}

function Details({ fields }: { fields: readonly (readonly [string, string])[] }) {
  return (
    <ThemedText wrap="truncate">
      {fields.map(([label, value], index) => (
        <ThemedText key={index}>
          <ThemedText color="subtle">
            {index ? " · " : ""}
            {label ? `${label} ` : ""}
          </ThemedText>
          {value}
        </ThemedText>
      ))}
    </ThemedText>
  );
}

export function StatusLine(props: StatusLineProps) {
  const [hover, setHover] = useState<HoverField>();
  const hoverProps = (field: HoverField) => ({
    onMouseEnter: () => setHover(field),
    onMouseLeave: () => setHover(undefined),
  });
  const width = Math.max(0, props.columns - 2);
  const t = createTuiI18n(props.locale ?? "zh");
  const segments = contextSegments.map((segment) => ({
    ...segment,
    name: t(`status.${segment.key}`),
    short: t(`status.${segment.key}-short`),
  }));
  const description = {
    label: t(`permission-mode.${props.mode}.name`),
    full: t(`permission-mode.${props.mode}.description`),
    compact: t(`permission-mode.${props.mode}.compact`),
  };
  const modeWidth = Bun.stringWidth(description.label);
  const planLabel = t("plan.chip");
  const planWidth = props.planMode ? Bun.stringWidth(planLabel) : 0;
  const goalPhase = props.goal && goalPhasePresentation[props.goal.phase];
  const goalLabel = props.goal
    ? `${goalPhase?.glyph} ${props.goal.roundsStarted}/${props.goal.maxRounds}`
    : "";
  const goalWidth = Bun.stringWidth(goalLabel);
  const liveJobs =
    props.jobs?.filter((job) => job.status === "running" || job.status === "stopping") ?? [];
  const jobsLabel = liveJobs.length ? `● ${liveJobs.length}` : "";
  const jobsWidth = Bun.stringWidth(jobsLabel);
  const requiredWidth =
    modeWidth +
    (jobsWidth ? jobsWidth + 1 : 0) +
    (planWidth ? planWidth + 1 : 0) +
    (goalWidth ? goalWidth + 1 : 0);
  const usage = props.contextUsage;
  const showBar = props.showContextBar !== false && usage !== undefined && width >= 14;
  const pct = usage && usage.window > 0 ? (usage.used / usage.window) * 100 : 0;
  const counts = usage ? `${count(usage.used)}/${count(usage.window)}` : "";
  const ctx = usage ? `${t("status.ctx")} ${percentage(pct)}% (${counts})` : "";
  const widths = usage ? barWidths(usage, width) : [];
  const free = widths[5] ?? 0;
  const full = `${counts} ${pct.toFixed(1)}%`;
  const short = `${pct.toFixed(1)}%`;
  const readout = full.length <= free ? full : short.length <= free ? short : "";
  const speed = Math.max(0, props.tps);
  const peak = Math.max(40, speed, ...props.tpsSamples.map(({ value }) => value));
  const meter = gauge(speed / peak, 11);
  const samples = props.tpsSamples.slice(-12);
  const speedParts: { text: string; color?: ThemeColor; dim?: boolean }[] = props.working
    ? [
        { text: "▕" },
        { text: meter.fill, color: speedColor(speed) },
        { text: meter.track, dim: true },
        { text: "▏ " },
      ]
    : [...sparkline(samples)].map((text, index) => ({
        text,
        color: speedColor(samples[index]!.value),
      }));
  if (samples.length) {
    if (!props.working) speedParts.push({ text: " " });
    speedParts.push(
      { text: String(Math.round(speed)), color: speedColor(speed) },
      { text: ` ${t("status.tps")}` },
    );
  } else {
    speedParts.push({
      text: `${Math.round(speed)} ${t(props.working ? "status.tps" : "status.tps-idle")}`,
      dim: true,
    });
  }
  const speedText = speedParts.map(({ text }) => text).join("");
  const speedView = (
    <ThemedText>
      {speedParts.map(({ text, color, dim }, index) => (
        <ThemedText key={index} color={color} dim={dim}>
          {text}
        </ThemedText>
      ))}
    </ThemedText>
  );
  const totalInput = props.usage.input + props.usage.cacheRead + props.usage.cacheWrite;
  const cacheRate = totalInput > 0 ? (props.usage.cacheRead / totalInput) * 100 : undefined;
  const fields: { id: HoverField | "effort" | "plan" | "goal"; content: ReactNode }[] = [
    ...(props.goal ? [{ id: "goal" as const, content: goalLabel }] : []),
    { id: "mode", content: description.label },
    ...(jobsWidth ? [{ id: "jobs" as const, content: jobsLabel }] : []),
    ...(props.planMode ? [{ id: "plan" as const, content: planLabel }] : []),
    { id: "model", content: props.model },
    { id: "tps", content: speedView },
    ...(props.thinking ? [{ id: "effort" as const, content: props.thinking }] : []),
    ...(cacheRate !== undefined
      ? [
          {
            id: "cache" as const,
            content: t("status.cache-rate", { percent: cacheRate.toFixed(1) }),
          },
        ]
      : []),
    { id: "tokens", content: `${count(props.usage.input)}→${count(props.usage.output)}` },
    ...(props.gitBranch ? [{ id: "git" as const, content: props.gitBranch }] : []),
    { id: "cwd", content: basename(props.cwd) || props.cwd },
  ];
  const ctxWidth = Math.min(ctx.length, Math.max(0, width - requiredWidth - (ctx ? 1 : 0)));
  const leftWidth = Math.max(0, width - ctxWidth - (ctx ? 1 : 0));
  // Keep permission policy and live job/plan/goal chips before optional fields.
  while (
    fields.length > 1 + Number(!!props.planMode) + Number(!!props.goal) + Number(!!jobsWidth) &&
    leftWidth < requiredWidth + (fields.length - 1) * 2
  )
    fields.pop();
  const separator = leftWidth >= requiredWidth + (fields.length - 1) * 4 ? " · " : "·";
  const naturalWidths = fields.map(({ id, content }) =>
    Bun.stringWidth(id === "tps" ? speedText : String(content)),
  );
  const budget = Math.max(0, leftWidth - separator.length * (fields.length - 1));
  const fieldWidths =
    naturalWidths.reduce((sum, value) => sum + value, 0) <= budget
      ? naturalWidths
      : allocateColumns(
          naturalWidths,
          fields.map(({ id }) =>
            id === "jobs"
              ? jobsWidth
              : id === "mode"
                ? modeWidth
                : id === "plan"
                  ? planWidth
                  : id === "goal"
                    ? goalWidth
                    : 1,
          ),
          budget,
        );
  let detail: ReactNode;
  if (hover === "jobs" && liveJobs.length)
    detail = (
      <Details
        fields={liveJobs.map((job) => [
          "",
          `${Bun.stripANSI(job.label).replace(/\s+/g, " ")} ${fmtDuration(Math.max(0, props.now - job.startedAt), props.locale ?? "zh")}`,
        ])}
      />
    );
  if (hover === "mode") {
    const fits =
      Bun.stringWidth(
        `${t("status.mode")} ${description.label} · ${description.full} · ${t("status.switch-mode")}`,
      ) <= width;
    detail = (
      <Details
        fields={
          fits
            ? [
                [t("status.mode"), description.label],
                ["", description.full],
                ["", t("status.switch-mode")],
              ]
            : [
                ["", description.compact],
                ["", t("status.switch")],
              ]
        }
      />
    );
  }
  if (hover === "ctx" && usage)
    detail = (
      <Details
        fields={[
          ["", `${percentage(pct)}%`],
          ["", counts],
          [t("status.free"), count(Math.max(0, usage.window - usage.used))],
          ...segments.map(({ key, short }) => [short, count(usage.segments[key])] as const),
        ]}
      />
    );
  if (hover === "bar" && usage) {
    const budget = Math.max(0, props.columns - 6);
    const forms = [
      { separator: " · ", short: false },
      { separator: " ", short: false },
      { separator: " ", short: true },
    ];
    const form =
      forms.find(
        ({ separator, short }) =>
          Bun.stringWidth(
            segments
              .map(
                (segment) =>
                  `■ ${short ? segment.short : segment.name} ${count(usage.segments[segment.key])}`,
              )
              .join(separator),
          ) <= budget,
      ) ?? forms[2]!;
    detail = (
      <Box flexShrink={0} width={budget}>
        <ThemedText wrap="truncate">
          {segments.map(({ key, name, short, color }, index) => (
            <ThemedText key={key}>
              <ThemedText color="subtle">{index ? form.separator : ""}</ThemedText>
              <ThemedText color={color}>■</ThemedText>
              <ThemedText color="subtle">{` ${form.short ? short : name} `}</ThemedText>
              {count(usage.segments[key])}
            </ThemedText>
          ))}
        </ThemedText>
      </Box>
    );
  }
  if (hover === "cache" && cacheRate !== undefined)
    detail = (
      <Details
        fields={[
          [t("status.cache"), `${cacheRate.toFixed(1)}%`],
          [t("status.read"), count(props.usage.cacheRead)],
          [t("status.write"), count(props.usage.cacheWrite)],
          [t("status.input"), count(props.usage.input)],
        ]}
      />
    );
  if (hover === "model")
    detail = (
      <Details
        fields={[
          [t("status.model"), props.model],
          [t("status.provider"), props.provider],
          [t("status.ctx"), usage ? count(usage.window) : "—"],
        ]}
      />
    );
  if (hover === "git") detail = <Details fields={[[t("status.git"), props.gitBranch ?? ""]]} />;
  if (hover === "cwd") detail = <Details fields={[[t("status.cwd"), props.cwd]]} />;
  if (hover === "tokens")
    detail = (
      <Details
        fields={[
          [t("status.in"), props.usage.input.toLocaleString("en-US")],
          [t("status.out"), props.usage.output.toLocaleString("en-US")],
          [t("status.total"), (totalInput + props.usage.output).toLocaleString("en-US")],
        ]}
      />
    );
  if (hover === "tps") {
    const mean = (values: readonly number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const sorted = props.tpsSamples.map(({ value }) => value).sort((a, b) => a - b);
    const recent = props.tpsSamples
      .filter(({ at }) => at >= props.now - 60_000 && at <= props.now)
      .map(({ value }) => value);
    detail = (
      <Details
        fields={[
          [t("status.tps"), String(Math.round(speed))],
          [t("status.avg60"), mean(recent).toFixed(1)],
          [t("status.mean"), mean(sorted).toFixed(1)],
          [t("status.p95"), (sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0).toFixed(1)],
        ]}
      />
    );
  }
  return (
    <Box
      width={props.columns}
      height={showBar ? 3 : 2}
      paddingX={1}
      flexDirection="column"
      flexShrink={0}
    >
      {showBar && (
        <Box height={1} flexShrink={0} {...hoverProps("bar")}>
          <ThemedText wrap="truncate">
            {segments.map(({ key, color }, index) => (
              <ThemedText key={key} backgroundColor={color}>
                {" ".repeat(widths[index] ?? 0)}
              </ThemedText>
            ))}
            <ThemedText backgroundColor="barFree" color={pct >= 80 ? pressure(pct) : "barFreeText"}>
              {" ".repeat(free - readout.length) + readout}
            </ThemedText>
          </ThemedText>
        </Box>
      )}
      <Box height={1} flexShrink={0}>
        <Box width={leftWidth} flexShrink={1}>
          {fields.map(
            ({ id, content }, index) =>
              fieldWidths[index]! > 0 && (
                <Box key={id} flexShrink={1}>
                  {index > 0 && (
                    <Box width={separator.length} flexShrink={0}>
                      <ThemedText color="subtle" wrap="truncate">
                        {separator}
                      </ThemedText>
                    </Box>
                  )}
                  <Box
                    width={fieldWidths[index]}
                    flexShrink={1}
                    {...(id !== "effort" && id !== "plan" && id !== "goal" ? hoverProps(id) : {})}
                  >
                    <ThemedText
                      color={
                        id === "jobs"
                          ? "warning"
                          : id === "goal"
                            ? goalPhase?.color
                            : id === "plan"
                              ? "plan"
                              : id === "mode" && props.mode === "full-access"
                                ? "error"
                                : undefined
                      }
                      dim={id === "goal" && goalPhase?.dimColor}
                      wrap="truncate"
                    >
                      {typeof content === "string"
                        ? textLines(
                            [{ text: content, style: {} }],
                            fieldWidths[index],
                            false,
                            true,
                          )[0]
                            ?.map((glyph) => glyph.text)
                            .join("")
                        : content}
                    </ThemedText>
                  </Box>
                </Box>
              ),
          )}
          <Box flexShrink={0} flexGrow={1} />
        </Box>
        {ctx && <Box width={1} flexShrink={0} />}
        <Box width={ctxWidth} flexShrink={0} {...(usage ? hoverProps("ctx") : {})}>
          <ThemedText wrap="truncate">
            {hover === "ctx" && usage ? (
              <>
                {t("status.ctx")}{" "}
                <Meter value={pct / 100} width={counts.length + 2} color={pressure(pct)} />{" "}
                {percentage(pct)}%
              </>
            ) : (
              ctx
            )}
          </ThemedText>
        </Box>
      </Box>
      <Box height={1} flexShrink={0}>
        {detail ?? (
          <ThemedText color="subtle" wrap="truncate">
            {props.working ? t("status.interrupt") : ""}
          </ThemedText>
        )}
      </Box>
    </Box>
  );
}
import { fmtDuration, type Locale } from "@rukie/i18n";
import { createTuiI18n } from "../../../view/i18n";
