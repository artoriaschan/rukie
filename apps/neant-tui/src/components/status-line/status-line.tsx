import { useState, type ReactNode } from "react";
import { basename } from "node:path";
import { Box, ThemedText, type ThemeColor } from "@neant/tui";
import type { ContextUsageEvent, PermissionMode, RunResult, ThinkingLevel } from "@neant/shared";
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
  mode: PermissionMode;
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

type HoverField = "bar" | "ctx" | "mode" | "model" | "tps" | "cache" | "tokens" | "git" | "cwd";

const modeDescriptions: Record<PermissionMode, { full: string; compact: string }> = {
  ask: { full: "只读工具直接允许，其余请求批准", compact: "非只读需批准" },
  "auto-review": {
    full: "自动评审工具调用，有风险或评审失败时请求批准",
    compact: "评审，有风险询问",
  },
  "full-access": { full: "允许所有工具调用，无权限拦截", compact: "全部允许，无拦截" },
};

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
  const showBar = usage !== undefined && width >= 14;
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
  const samples = props.tpsSamples.slice(-12);
  const speedParts: { text: string; color?: ThemeColor; dimColor?: boolean }[] = props.working
    ? [
        { text: "▕" },
        { text: meter.fill, color: speedColor(speed) },
        { text: meter.track, dimColor: true },
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
      { text: " tps" },
    );
  } else {
    speedParts.push({
      text: `${Math.round(speed)} ${props.working ? "tps" : "t/s"}`,
      dimColor: true,
    });
  }
  const speedText = speedParts.map(({ text }) => text).join("");
  const speedView = (
    <ThemedText>
      {speedParts.map(({ text, color, dimColor }, index) => (
        <ThemedText key={index} color={color} dimColor={dimColor}>
          {text}
        </ThemedText>
      ))}
    </ThemedText>
  );
  const totalInput = props.usage.input + props.usage.cacheRead + props.usage.cacheWrite;
  const cacheRate = totalInput > 0 ? (props.usage.cacheRead / totalInput) * 100 : undefined;
  const fields: { id: HoverField | "effort"; content: ReactNode }[] = [
    { id: "mode", content: props.mode },
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
  const ctxWidth = Math.min(ctx.length, Math.max(0, width - props.mode.length - (ctx ? 1 : 0)));
  const leftWidth = Math.max(0, width - ctxWidth - (ctx ? 1 : 0));
  // Keep the permission policy legible before spending columns on optional fields.
  while (fields.length > 1 && leftWidth < props.mode.length + (fields.length - 1) * 2) fields.pop();
  const separator = leftWidth >= props.mode.length + (fields.length - 1) * 4 ? " · " : "·";
  const naturalWidths = fields.map(({ id, content }) =>
    Bun.stringWidth(id === "tps" ? speedText : String(content)),
  );
  const budget = Math.max(0, leftWidth - separator.length * (fields.length - 1));
  const fieldWidths =
    naturalWidths.reduce((sum, value) => sum + value, 0) <= budget
      ? naturalWidths
      : allocateColumns(
          naturalWidths,
          fields.map(({ id }) => (id === "mode" ? props.mode.length : 1)),
          budget,
        );
  let detail: ReactNode;
  if (hover === "mode") {
    const description = modeDescriptions[props.mode];
    const fits =
      Bun.stringWidth(`mode ${props.mode} · ${description.full} · shift+tab 切换模式`) <= width;
    detail = (
      <Details
        fields={
          fits
            ? [
                ["mode", props.mode],
                ["", description.full],
                ["", "shift+tab 切换模式"],
              ]
            : [
                ["", description.compact],
                ["", "shift+tab 切换"],
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
    <Box
      width={props.columns}
      height={showBar ? 3 : 2}
      paddingX={1}
      flexDirection="column"
      flexShrink={0}
    >
      {showBar && (
        <Box height={1} flexShrink={0} {...hoverProps("bar")}>
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
                    {...(id !== "effort" ? hoverProps(id) : {})}
                  >
                    <ThemedText
                      color={id === "mode" && props.mode === "full-access" ? "error" : undefined}
                      wrap="truncate"
                    >
                      {content}
                    </ThemedText>
                  </Box>
                </Box>
              ),
          )}
          <Box flexGrow={1} />
        </Box>
        {ctx && <Box width={1} flexShrink={0} />}
        <Box width={ctxWidth} flexShrink={0} {...(usage ? hoverProps("ctx") : {})}>
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
            {props.working ? "esc 中断" : ""}
          </ThemedText>
        )}
      </Box>
    </Box>
  );
}
