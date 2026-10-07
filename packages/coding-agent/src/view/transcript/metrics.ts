export interface TpsSample {
  at: number;
  value: number;
}
import type { ContextUsageEvent } from "@rukie/shared";

export const segments = [
  { key: "system", color: "barSystem" },
  { key: "prompt", color: "barPrompt" },
  { key: "assistant", color: "barAssistant" },
  { key: "thinking", color: "barThinking" },
  { key: "tools", color: "barTools" },
] as const;

export function count(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function percentage(value: number): string {
  const bounded = Math.max(0, Math.min(999, value));
  return bounded < 10 ? bounded.toFixed(1) : String(Math.round(bounded));
}

export function pressure(value: number) {
  return value >= 95 ? "error" : value >= 80 ? "warning" : "success";
}

/** Apportion provider usage by the estimated composition, keeping tiny used segments visible. */
export function barWidths(usage: ContextUsageEvent, width: number): number[] {
  const estimates = segments.map(({ key }) => Math.max(0, usage.segments[key]));
  const total = estimates.reduce((sum, value) => sum + value, 0);
  const used = Math.max(0, Math.min(usage.window, usage.used));
  const weights = estimates.map((value) => (total > 0 ? (value / total) * used : 0));
  weights.push(Math.max(0, usage.window - used));
  return allocateColumns(weights, estimates.map((value) => (value > 0 ? 1 : 0)).concat(0), width);
}

/** Constrained largest-remainder allocation; ties retain the input order. */
export function allocateColumns(
  weights: readonly number[],
  minimums: readonly number[],
  width: number,
): number[] {
  const widths = weights.map(() => 0);
  let remaining = width;
  let indices = weights.map((_, index) => index);
  while (indices.length) {
    const sum = indices.reduce((value, index) => value + weights[index]!, 0);
    const tiny = indices.filter(
      (index) =>
        minimums[index]! > 0 &&
        (sum === 0 || (remaining * weights[index]!) / sum < minimums[index]!),
    );
    if (!tiny.length) break;
    for (const index of tiny) {
      widths[index] = Math.min(remaining, minimums[index]!);
      remaining -= widths[index]!;
    }
    indices = indices.filter((index) => !tiny.includes(index));
  }
  const sum = indices.reduce((value, index) => value + weights[index]!, 0);
  if (sum === 0) {
    if (indices.length) widths[indices.at(-1)!] = remaining;
    return widths;
  }
  const shares = indices.map((index) => ({ index, exact: (remaining * weights[index]!) / sum }));
  for (const { index, exact } of shares) widths[index] = Math.floor(exact);
  const spare = remaining - shares.reduce((value, { index }) => value + widths[index]!, 0);
  shares.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)));
  for (const { index } of shares.slice(0, spare)) widths[index]! += 1;
  return widths;
}

export function speedColor(value: number) {
  return value >= 50 ? "success" : value >= 20 ? "warning" : "error";
}

export function gauge(value: number, cells: number): { fill: string; track: string } {
  const eighths = Math.round(Math.max(0, Math.min(1, value)) * cells * 8);
  const full = Math.floor(eighths / 8);
  const fraction = eighths % 8;
  const fill = "█".repeat(full) + (fraction ? "▏▎▍▌▋▊▉"[fraction - 1] : "");
  return { fill, track: "·".repeat(cells - full - (fraction ? 1 : 0)) };
}

export function sparkline(samples: readonly { value: number }[]): string {
  const values = samples.slice(-12).map(({ value }) => value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return values
    .map(
      (value) =>
        "▁▂▃▄▅▆▇█"[range < 1e-6 ? (max > 0 ? 4 : 0) : Math.round(((value - min) / range) * 7)],
    )
    .join("");
}
