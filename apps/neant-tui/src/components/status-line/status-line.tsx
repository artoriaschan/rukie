import { useState, type ReactNode } from "react";
import { basename } from "node:path";
import { Box, ThemedText, type ThemeColor } from "@neant/tui";
import type { ContextUsageEvent, RunResult, ThinkingLevel } from "@neant/shared";
import {
  allocateColumns,
  barWidths,
  count,
  gauge,
  percentage,
  pressure,
  segments,
  sparkline,
  speedColor,
} from "./metrics";

export interface TpsSample {
  at: number;
  value: number;
}
export interface StatusLineProps {
  columns: number;
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
  scrollHint?: string;
}

type HoverField = "bar" | "ctx" | "model" | "tps" | "cache" | "tokens" | "git" | "cwd";

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
  const usage = props.contextUsage;
  const pct = usage && usage.window > 0 ? (usage.used / usage.window) * 100 : 0;
  const counts = usage ? `${count(usage.used)}/${count(usage.window)}` : "";
  const ctx = usage ? `ctx ${percentage(pct)}% (${counts})` : "";
  const widths = usage ? barWidths(usage, width) : [];
  const free = widths[5] ?? 0;
  const full = `${counts} ${pct.toFixed(1)}%`;
  const short = `${pct.toFixed(1)}%`;
  const readout = full.length <= free ? full : short.length <= free ? short : "";
  const speed = Math.max(0, props.tps);
  const peak = Math.max(40, speed, ...props.tpsSamples.map(({ value }) => value));
  const meter = gauge(speed / peak, 11);
  const speedParts: { text: string; color: ThemeColor }[] = props.working
    ? [
        { text: `▕${meter.fill}`, color: speedColor(speed) },
        { text: `${meter.track}▏ `, color: "subtle" },
        { text: `${Math.round(speed)} tps`, color: speedColor(speed) },
      ]
    : props.tpsSamples.length
      ? [{ text: sparkline(props.tpsSamples), color: speedColor(speed) }]
      : [{ text: `${Math.round(speed)} t/s`, color: "subtle" }];
  const speedText = speedParts.map(({ text }) => text).join("");
  const speedView = (
    <ThemedText>
      {speedParts.map(({ text, color }, index) => (
        <ThemedText key={index} color={color}>
          {text}
        </ThemedText>
      ))}
    </ThemedText>
  );
  const totalInput = props.usage.input + props.usage.cacheRead + props.usage.cacheWrite;
  const cacheRate = totalInput > 0 ? (props.usage.cacheRead / totalInput) * 100 : undefined;
  const fields: { id: HoverField | "effort"; content: ReactNode }[] = [
    { id: "model", content: props.model },
    { id: "tps", content: speedView },
    ...(props.thinking ? [{ id: "effort" as const, content: props.thinking }] : []),
    ...(cacheRate !== undefined
      ? [{ id: "cache" as const, content: `缓存 ${cacheRate.toFixed(1)}%` }]
      : []),
    { id: "tokens", content: `${count(props.usage.input)}→${count(props.usage.output)}` },
    ...(props.gitBranch ? [{ id: "git" as const, content: props.gitBranch }] : []),
    { id: "cwd", content: basename(props.cwd) || props.cwd },
  ];
  const leftWidth = Math.max(0, width - ctx.length - (ctx ? 1 : 0));
  const separator = leftWidth >= fields.length + (fields.length - 1) * 3 ? " · " : "·";
  const naturalWidths = fields.map(({ id, content }) =>
    Bun.stringWidth(id === "tps" ? speedText : String(content)),
  );
  const budget = Math.max(0, leftWidth - separator.length * (fields.length - 1));
  const fieldWidths =
    naturalWidths.reduce((sum, value) => sum + value, 0) <= budget
      ? naturalWidths
      : allocateColumns(
          naturalWidths,
          fields.map(() => 1),
          budget,
        );
  let detail: ReactNode;
  if (hover === "ctx" && usage)
    detail = (
      <Details
        fields={[
          ["", `${percentage(pct)}%`],
          ["", counts],
          ["free", count(Math.max(0, usage.window - usage.used))],
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
      <Box width={budget}>
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
          ["cache", `${cacheRate.toFixed(1)}%`],
          ["read", count(props.usage.cacheRead)],
          ["write", count(props.usage.cacheWrite)],
          ["input", count(props.usage.input)],
        ]}
      />
    );
  if (hover === "model")
    detail = (
      <Details
        fields={[
          ["model", props.model],
          ["provider", props.provider],
          ["ctx", usage ? count(usage.window) : "—"],
        ]}
      />
    );
  if (hover === "git") detail = <Details fields={[["git", props.gitBranch ?? ""]]} />;
  if (hover === "cwd") detail = <Details fields={[["cwd", props.cwd]]} />;
  if (hover === "tokens")
    detail = (
      <Details
        fields={[
          ["in", props.usage.input.toLocaleString("en-US")],
          ["out", props.usage.output.toLocaleString("en-US")],
          ["total", (totalInput + props.usage.output).toLocaleString("en-US")],
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
          ["tps", String(Math.round(speed))],
          ["avg60", mean(recent).toFixed(1)],
          ["mean", mean(sorted).toFixed(1)],
          ["p95", (sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0).toFixed(1)],
        ]}
      />
    );
  }
  return (
    <Box width={props.columns} height={3} paddingX={1} flexDirection="column" flexShrink={0}>
      <Box height={1} flexShrink={0} {...(usage && width >= 14 ? hoverProps("bar") : {})}>
        {usage && width >= 14 && (
          <ThemedText preserveWhitespace wrap="truncate">
            {segments.map(({ key, color }, index) => (
              <ThemedText key={key} backgroundColor={color}>
                {" ".repeat(widths[index] ?? 0)}
              </ThemedText>
            ))}
            <ThemedText backgroundColor="barFree" color={pct >= 80 ? pressure(pct) : "barFreeText"}>
              {" ".repeat(free - readout.length) + readout}
            </ThemedText>
          </ThemedText>
        )}
      </Box>
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
                    {...(id !== "effort" ? hoverProps(id) : {})}
                  >
                    <ThemedText wrap="truncate">{content}</ThemedText>
                  </Box>
                </Box>
              ),
          )}
          <Box flexGrow={1} />
        </Box>
        {ctx && <Box width={1} flexShrink={0} />}
        <Box width={ctx.length} flexShrink={0} {...(usage ? hoverProps("ctx") : {})}>
          <ThemedText wrap="truncate">
            {hover === "ctx" && usage ? (
              <>
                ctx <Meter value={pct / 100} width={counts.length + 2} color={pressure(pct)} />{" "}
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
            {props.scrollHint || (props.working ? "esc 中断" : "")}
          </ThemedText>
        )}
      </Box>
    </Box>
  );
}
