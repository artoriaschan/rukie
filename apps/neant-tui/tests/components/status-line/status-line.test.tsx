import { afterEach, expect, test } from "bun:test";
import { useState } from "react";
import { Box, ThemedText, dark, render, ThemeProvider } from "@neant/tui";
import { StatusLine } from "../../../src/components";
import type { StatusLineProps, TpsSample } from "../../../src/components/status-line";
import { createTerminal } from "../../helpers/terminal";

const props: StatusLineProps = {
  columns: 80,
  mode: "ask",
  model: "deepseek-chat",
  provider: "deepseek",
  contextUsage: {
    type: "context_usage",
    used: 12_500,
    window: 64_000,
    segments: { system: 1000, prompt: 2000, assistant: 3000, thinking: 4000, tools: 2500 },
  },
  thinking: "high",
  tps: 42,
  tpsSamples: [],
  now: 60_000,
  usage: { input: 12_000, output: 3000, cacheRead: 20_000, cacheWrite: 0 },
  gitBranch: "main",
  cwd: "/work/Neant",
  working: true,
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function mount(overrides: Partial<StatusLineProps> = {}) {
  const values = { ...props, ...overrides };
  const terminal = createTerminal(values.columns, 6);
  let update = (_next: Partial<StatusLineProps>) => {};
  function View() {
    const [next, setNext] = useState(values);
    update = (patch) => setNext((current) => ({ ...current, ...patch }));
    return (
      <ThemeProvider>
        <Box flexDirection="column">
          <StatusLine {...next} />
          <ThemedText>after footer</ThemedText>
        </Box>
      </ThemeProvider>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  cleanups.push(async () => {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  });
  await terminal.flush();
  return { ...terminal, rerender: (next: Partial<StatusLineProps>) => update(next) };
}
function rgb(color: string) {
  return Number.parseInt(color.slice(1), 16);
}
function columnOf(line: string, text: string) {
  return Bun.stringWidth(line.slice(0, line.indexOf(text)));
}

test("permission mode names are Chinese and update from props with danger color", async () => {
  const terminal = await mount({ columns: 160 });
  expect(terminal.screen()[1]).toStartWith(" 询问 · deepseek-chat");
  terminal.rerender({ mode: "auto-review" });
  await terminal.waitFor(() => terminal.screen()[1]!.startsWith(" 自动评审 ·"));
  terminal.rerender({ mode: "full-access" });
  await terminal.waitFor(() => terminal.screen()[1]!.startsWith(" 完全访问 ·"));
  expect(terminal.terminal.buffer.active.getLine(1)!.getCell(1)!.getFgColor()).toBe(
    rgb(dark.error),
  );
});

test("status occupies three padded rows with the readout inside the free segment", async () => {
  const terminal = await mount();
  expect(terminal.screen()[0]).toEndWith("13k/64k 19.5%");
  expect(terminal.screen()[1]).toEndWith("ctx 20% (13k/64k)");
  expect(terminal.screen()[2]).toBe(" esc 中断");
  expect(terminal.screen()[3]).toBe("after footer");
  const row = terminal.terminal.buffer.active.getLine(0)!;
  expect(row.getCell(0)!.getBgColorMode()).toBe(0);
  expect(row.getCell(1)!.getBgColor()).toBe(rgb(dark.barSystem));
  expect(row.getCell(78)!.getBgColor()).toBe(rgb(dark.barFree));
  expect(row.getCell(79)!.getBgColorMode()).toBe(0);
});

test("bar apportions fractional shares by largest remainder and keeps tiny nonzero segments", async () => {
  const terminal = await mount({
    columns: 21,
    contextUsage: {
      type: "context_usage",
      used: 50,
      window: 100,
      segments: { system: 10, prompt: 20, assistant: 20, thinking: 0, tools: 0 },
    },
  });
  const row = terminal.terminal.buffer.active.getLine(0)!;
  const backgrounds = Array.from({ length: 19 }, (_, x) => row.getCell(x + 1)!.getBgColor());
  expect(backgrounds).toEqual([
    ...Array(2).fill(rgb(dark.barSystem)),
    ...Array(4).fill(rgb(dark.barPrompt)),
    ...Array(4).fill(rgb(dark.barAssistant)),
    ...Array(9).fill(rgb(dark.barFree)),
  ]);
  terminal.rerender({
    contextUsage: {
      type: "context_usage",
      used: 1,
      window: 1000,
      segments: { system: 1, prompt: 1, assistant: 1, thinking: 1, tools: 1 },
    },
  });
  await terminal.waitFor(() => terminal.screen()[0]!.includes("0.1%"));
  for (const [index, color] of [
    dark.barSystem,
    dark.barPrompt,
    dark.barAssistant,
    dark.barThinking,
    dark.barTools,
  ].entries())
    expect(
      terminal.terminal.buffer.active
        .getLine(0)!
        .getCell(index + 1)!
        .getBgColor(),
    ).toBe(rgb(color));
});

test.each([
  [82, 12_500, "13k/64k 19.5%"],
  [18, 12_500, "19.5%"],
  [16, 63_360, ""],
])("bar readout degrades at %s columns with %s used", async (columns, used, readout) => {
  const terminal = await mount({ columns, contextUsage: { ...props.contextUsage!, used } });
  expect(terminal.screen()[0]).toBe(
    readout ? " ".repeat(columns - 1 - readout.length) + readout : "",
  );
  expect(terminal.screen()[3]).toBe("after footer");
});

test("a hidden narrow context bar leaves no row above the fields and keeps the hint row", async () => {
  const terminal = await mount({ columns: 15 });
  expect(terminal.screen()[0]?.trimStart()).toStartWith("询问 ");
  expect(terminal.screen()[1]).toBe(" esc 中断");
  expect(terminal.screen()[2]).toBe("after footer");
  for (let x = 0; x < 15; x++)
    expect(terminal.terminal.buffer.active.getLine(0)!.getCell(x)!.getBgColorMode()).toBe(0);
  terminal.rerender({ working: false });
  await terminal.waitFor(() => terminal.screen()[1] === "");
  expect(terminal.screen()[2]).toBe("after footer");
});

test.each([
  [79.9, dark.barFreeText],
  [80, dark.warning],
  [95, dark.error],
])("bar pressure %s uses its theme color", async (pct, color) => {
  const terminal = await mount({
    columns: 160,
    contextUsage: { ...props.contextUsage!, used: pct * 640 },
  });
  const row = terminal.terminal.buffer.active.getLine(0)!;
  expect(row.getCell(158)!.getFgColor()).toBe(rgb(color));
});

test("compact fields are ordered and missing optional fields leave no spare separators", async () => {
  const terminal = await mount({
    columns: 160,
    working: false,
    thinking: undefined,
    gitBranch: undefined,
    usage: { input: 12_000, output: 3000, cacheRead: 0, cacheWrite: 0 },
  });
  expect(terminal.screen()[1]!.trim()).toMatch(
    /^询问 · deepseek-chat · 42 t\/s · 缓存 0.0% · 12k→3.0k · Neant +ctx 20% \(13k\/64k\)$/,
  );
  expect(terminal.screen()[2]).toBe("");
});

test.each([
  [50, dark.success],
  [20, dark.warning],
  [19, dark.error],
])(
  "working tps %s without samples colors only the gauge fill and dims the readout",
  async (tps, color) => {
    const terminal = await mount({ columns: 160, tps });
    const line = terminal.screen()[1]!;
    expect(line).toContain(
      tps === 19
        ? "▕█████▎·····▏ 19 tps"
        : tps === 20
          ? "▕█████▌·····▏ 20 tps"
          : "▕███████████▏ 50 tps",
    );
    const row = terminal.terminal.buffer.active.getLine(1)!;
    const start = columnOf(line, "▕");
    expect(row.getCell(start)!.getFgColor()).toBe(rgb(dark.text));
    expect(row.getCell(start + 1)!.getFgColor()).toBe(rgb(color));
    expect(row.getCell(start + 12)!.getFgColor()).toBe(rgb(dark.text));
    expect(row.getCell(start + 12)!.isDim()).toBe(0);
    if (tps < 40) expect(row.getCell(start + 7)!.isDim()).toBeTruthy();
    const x = columnOf(line, `${tps} tps`);
    expect(row.getCell(x)!.getFgColor()).toBe(rgb(dark.text));
    expect(row.getCell(x)!.isDim()).toBeTruthy();
    expect(row.getCell(x + String(tps).length + 1)!.isDim()).toBeTruthy();
  },
);

test.each([
  [50, dark.success],
  [20, dark.warning],
  [19, dark.error],
])(
  "working tps %s with samples scales against the peak and colors only the number",
  async (tps, color) => {
    const terminal = await mount({ columns: 160, tps, tpsSamples: [{ at: 0, value: 100 }] });
    const line = terminal.screen()[1]!;
    expect(line).toContain(
      tps === 50
        ? "▕█████▌·····▏ 50 tps"
        : tps === 20
          ? "▕██▎········▏ 20 tps"
          : "▕██▏········▏ 19 tps",
    );
    const row = terminal.terminal.buffer.active.getLine(1)!;
    const x = columnOf(line, `${tps} tps`);
    expect(row.getCell(x)!.getFgColor()).toBe(rgb(color));
    expect(row.getCell(x)!.isDim()).toBe(0);
    expect(row.getCell(x + String(tps).length + 1)!.getFgColor()).toBe(rgb(dark.text));
  },
);

test("idle speed sparkline normalizes only the latest twelve samples", async () => {
  const samples: TpsSample[] = [999, ...Array.from({ length: 12 }, (_, i) => i)].map(
    (value, i) => ({ at: i * 1000, value }),
  );
  const terminal = await mount({
    columns: 160,
    working: false,
    tpsSamples: samples,
  });
  expect(terminal.screen()[1]).toContain("▁▂▂▃▄▄▅▅▆▇▇█ 42 tps");
  terminal.rerender({
    tpsSamples: [
      { at: 0, value: 42 },
      { at: 1, value: 42 },
    ],
  });
  await terminal.waitFor(() => terminal.screen()[1]!.includes("▅▅ 42 tps"));
  terminal.rerender({
    tps: 0,
    tpsSamples: [
      { at: 0, value: 0 },
      { at: 1, value: 0 },
    ],
  });
  await terminal.waitFor(() => terminal.screen()[1]!.includes("▁▁ 0 tps"));
});

test("idle sparkline colors each sample independently and keeps the current speed readout", async () => {
  const terminal = await mount({
    columns: 160,
    working: false,
    tpsSamples: [10, 20, 50].map((value, at) => ({ at, value })),
  });
  const line = terminal.screen()[1]!;
  expect(line).toContain("▁▃█ 42 tps");
  const row = terminal.terminal.buffer.active.getLine(1)!;
  const x = columnOf(line, "▁▃█");
  for (const [offset, color] of [dark.error, dark.warning, dark.success].entries())
    expect(row.getCell(x + offset)!.getFgColor()).toBe(rgb(color));
  expect(row.getCell(x + 4)!.getFgColor()).toBe(rgb(dark.warning));
  expect(row.getCell(x + 7)!.getFgColor()).toBe(rgb(dark.text));
});

async function move(terminal: Awaited<ReturnType<typeof mount>>, x: number, y: number) {
  terminal.stdin.write(`\x1b[<35;${x + 1};${y + 1}M`);
  await Bun.sleep(25);
  await terminal.flush();
}

test("mode hover explains the current policy and shortcut, then restores the hint", async () => {
  const terminal = await mount({ columns: 160 });
  await move(terminal, 1, 1);
  expect(terminal.screen()[2]).toBe(
    " 模式 询问 · 只读工具直接允许，其余请求批准 · shift+tab 切换模式",
  );
  terminal.rerender({ mode: "auto-review" });
  await terminal.waitFor(() => terminal.screen()[2]!.includes("模式 自动评审"));
  expect(terminal.screen()[2]).toBe(
    " 模式 自动评审 · 自动评审工具调用，有风险或评审失败时请求批准 · shift+tab 切换模式",
  );
  terminal.rerender({ mode: "full-access" });
  await terminal.waitFor(() => terminal.screen()[2]!.includes("模式 完全访问"));
  expect(terminal.screen()[2]).toBe(
    " 模式 完全访问 · 允许所有工具调用，无权限拦截 · shift+tab 切换模式",
  );
  await move(terminal, 0, 4);
  expect(terminal.screen()[2]).toBe(" esc 中断");
});

test.each([40, 60, 80])(
  "mode hover keeps both its explanation and shortcut at %s columns",
  async (columns) => {
    const terminal = await mount({ columns });
    for (const [mode, label, explanation] of [
      ["ask", "询问", /批准/],
      ["auto-review", "自动评审", /评审/],
      ["full-access", "完全访问", /允许/],
    ] as const) {
      terminal.rerender({ mode });
      await terminal.waitFor(() => terminal.screen()[1]!.startsWith(` ${label}`));
      await move(terminal, 1, 1);
      expect(terminal.screen()[2]).toContain("shift+tab");
      expect(terminal.screen()[2]).toMatch(explanation);
    }
  },
);

test.each([80, 60, 40])("Chinese permission modes stay readable at %s columns", async (columns) => {
  const terminal = await mount({ columns, mode: "auto-review" });
  expect(terminal.screen()[1]).toStartWith(" 自动评审");
  terminal.rerender({ mode: "full-access" });
  await terminal.waitFor(() => terminal.screen()[1]!.startsWith(" 完全访问"));
  for (let x = 1; x <= 8; x++)
    expect(terminal.terminal.buffer.active.getLine(1)!.getCell(x)!.getFgColor()).toBe(
      rgb(dark.error),
    );
});

test("mode remains complete when a large context readout competes for a narrow row", async () => {
  const terminal = await mount({
    columns: 40,
    mode: "full-access",
    contextUsage: { ...props.contextUsage!, used: 1_000_000, window: 1_000_000 },
  });
  expect(terminal.screen()[1]).toStartWith(" 完全访问");
});

test("motion swaps ctx in place, shows ctx/bar/cache details, and restores the interrupt hint", async () => {
  const terminal = await mount({ columns: 160 });
  const initial = terminal.screen()[1]!;
  const x = initial.indexOf("ctx ");
  await move(terminal, Bun.stringWidth(initial.slice(0, x)), 1);
  expect(terminal.screen()[1]!.indexOf("ctx ")).toBe(x);
  expect(terminal.screen()[1]!.length).toBe(initial.length);
  expect(terminal.screen()[1]).toContain("▕");
  expect(terminal.screen()[2]).toBe(
    " 20% · 13k/64k · free 52k · sys 1.0k · pr 2.0k · ast 3.0k · th 4.0k · tl 2.5k",
  );
  expect(terminal.screen()[3]).toBe("after footer");
  await move(terminal, 2, 0);
  expect(terminal.screen()[1]).toBe(initial);
  expect(terminal.screen()[2]).toBe(
    " ■ system 1.0k · ■ prompt 2.0k · ■ assistant 3.0k · ■ thinking 4.0k · ■ tools 2.5k",
  );
  await move(terminal, columnOf(initial, "缓存"), 1);
  expect(terminal.screen()[2]).toBe(" cache 62.5% · read 20k · write 0 · input 12k");
  await move(terminal, 0, 4);
  expect(terminal.screen()[2]).toBe(" esc 中断");
  terminal.rerender({ working: false });
  await terminal.waitFor(() => terminal.screen()[2] === "");
  expect(terminal.screen()[3]).toBe("after footer");
});

test.each([80, 60, 40])(
  "each field truncates independently at %s columns while ctx stays fixed",
  async (columns) => {
    const terminal = await mount({
      columns,
      model: "model-with-a-very-long-name",
      gitBranch: "branch-with-a-very-long-name",
      cwd: "/work/directory-with-a-very-long-name",
    });
    const line = terminal.screen()[1]!;
    expect(line).toEndWith("ctx 20% (13k/64k)");
    expect(Bun.stringWidth(line)).toBe(columns - 1);
    const fields = line
      .slice(1, line.indexOf("ctx "))
      .trim()
      .split(/ *· */);
    expect(fields).toHaveLength(8);
    expect(fields[0]).toBe("询问");
    expect(fields[1]).toStartWith(columns === 40 ? "m" : "mod");
    expect(fields[6]).toStartWith(columns === 40 ? "br" : "bra");
    expect(fields[7]).toStartWith(columns === 40 ? "di" : "dir");
    expect(terminal.screen()[3]).toBe("after footer");
  },
);

test("absent cache, effort and git fields produce a clean compact row", async () => {
  const terminal = await mount({
    columns: 120,
    working: false,
    thinking: undefined,
    gitBranch: undefined,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  });
  expect(terminal.screen()[1]!.trim()).toMatch(
    /^询问 · deepseek-chat · 42 t\/s · 0→0 · Neant +ctx 20% \(13k\/64k\)$/,
  );
  const x = columnOf(terminal.screen()[1]!, "42 t/s");
  expect(terminal.terminal.buffer.active.getLine(1)!.getCell(x)!.getFgColor()).toBe(rgb(dark.text));
  expect(terminal.terminal.buffer.active.getLine(1)!.getCell(x)!.isDim()).toBeTruthy();
});

test("hover details expose provider, full token numbers, speed statistics, branch and path", async () => {
  const terminal = await mount({
    columns: 160,
    tpsSamples: [
      { at: -1000, value: 10 },
      { at: 1000, value: 20 },
      { at: 60000, value: 60 },
    ],
  });
  const initial = terminal.screen()[1]!;
  for (const [field, detail] of [
    ["deepseek-chat", "model deepseek-chat · provider deepseek · ctx 64k"],
    ["42 tps", "tps 42 · avg60 40.0 · mean 30.0 · p95 60.0"],
    ["12k→3.0k", "in 12,000 · out 3,000 · total 35,000"],
    ["main", "git main"],
    ["Neant", "cwd /work/Neant"],
  ]) {
    await move(terminal, Bun.stringWidth(initial.slice(0, initial.indexOf(field!))), 1);
    expect(terminal.screen()[2]).toBe(` ${detail}`);
    const row = terminal.terminal.buffer.active.getLine(2)!;
    expect(row.getCell(1)!.getFgColor()).toBe(rgb(dark.subtle));
  }
  await move(terminal, Bun.stringWidth(initial.slice(0, initial.indexOf("high"))), 1);
  expect(terminal.screen()[2]).toBe(" esc 中断");
});

test.each([
  [79, dark.success],
  [80, dark.warning],
  [95, dark.error],
])("hover ctx keeps its width and paints pressure %s", async (pct, color) => {
  const terminal = await mount({
    columns: 160,
    contextUsage: { ...props.contextUsage!, used: pct * 640 },
  });
  const initial = terminal.screen()[1]!;
  const x = Bun.stringWidth(initial.slice(0, initial.indexOf("ctx ")));
  await move(terminal, x, 1);
  expect(Bun.stringWidth(terminal.screen()[1]!)).toBe(159);
  expect(terminal.screen()[1]!.indexOf("ctx ")).toBe(initial.indexOf("ctx "));
  expect(
    terminal.terminal.buffer.active
      .getLine(1)!
      .getCell(x + 5)!
      .getFgColor(),
  ).toBe(rgb(color));
});

test.each([
  [90, "■ system 1.0k · ■ prompt 2.0k · ■ assistant 3.0k · ■ thinking 4.0k · ■ tools 2.5k"],
  [80, "■ system 1.0k ■ prompt 2.0k ■ assistant 3.0k ■ thinking 4.0k ■ tools 2.5k"],
  [60, "■ sys 1.0k ■ pr 2.0k ■ ast 3.0k ■ th 4.0k ■ tl 2.5k"],
])("bar hover degrades its separators and names at %s columns", async (columns, detail) => {
  const terminal = await mount({ columns });
  await move(terminal, 2, 0);
  expect(terminal.screen()[2]).toBe(` ${detail}`);
  expect(terminal.terminal.buffer.active.getLine(2)!.getCell(1)!.getFgColor()).toBe(
    rgb(dark.barSystem),
  );
});

test("compact counts use lower-case m, small ctx percentages retain decimals, and percentages cap at 999", async () => {
  const terminal = await mount({
    columns: 160,
    usage: { input: 1_250_000, output: 10_000, cacheRead: 0, cacheWrite: 0 },
    contextUsage: { ...props.contextUsage!, used: 640 },
  });
  expect(terminal.screen()[1]).toContain("1.3m→10k");
  expect(terminal.screen()[1]).toEndWith("ctx 1.0% (640/64k)");
  terminal.rerender({ contextUsage: { ...props.contextUsage!, used: 1_000_000, window: 1000 } });
  await terminal.waitFor(() => terminal.screen()[1]!.endsWith("ctx 999% (1.0m/1.0k)"));
  expect(terminal.screen()[0]).toBe("");
});

test("an empty context paints free cells and missing context removes only the bar row", async () => {
  const terminal = await mount({
    contextUsage: {
      type: "context_usage",
      used: 0,
      window: 64_000,
      segments: { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 },
    },
  });
  expect(terminal.screen()[0]).toEndWith("0/64k 0.0%");
  expect(terminal.terminal.buffer.active.getLine(0)!.getCell(1)!.getBgColor()).toBe(
    rgb(dark.barFree),
  );
  terminal.rerender({ contextUsage: undefined });
  await terminal.waitFor(() => terminal.screen()[0]?.startsWith(" 询问 · deepseek-") === true);
  expect(terminal.screen()[0]).not.toContain("ctx");
  expect(terminal.screen()[1]).toBe(" esc 中断");
  expect(terminal.screen()[2]).toBe("after footer");
  terminal.rerender({ working: false });
  await terminal.waitFor(() => terminal.screen()[1] === "");
  expect(terminal.screen()[2]).toBe("after footer");
  terminal.rerender({ contextUsage: props.contextUsage });
  await terminal.waitFor(() => terminal.screen()[0]?.endsWith("13k/64k 19.5%") === true);
  expect(terminal.screen()[3]).toBe("after footer");
});
