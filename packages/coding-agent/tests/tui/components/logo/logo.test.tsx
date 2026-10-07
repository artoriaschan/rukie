import { expect, jest, test } from "bun:test";
import { act, useLayoutEffect, useState } from "react";
import { dark, renderSync, AlternateScreen, ThemeProvider } from "../../../../src/ink/index.ts";
import { Logo, mergeColoredCells, renderBigText } from "../../../../src/tui/components/logo";
import { createTerminal } from "../../../ink/helpers/terminal";

test("RUKIE is five rows with the horizontal gradient reaching both colored edge columns", () => {
  const rows = renderBigText("RUKIE", "#000000", "#ffffff");
  expect(rows).toHaveLength(5);
  expect(rows.map((row) => row.length)).toEqual([34, 34, 34, 34, 34]);
  expect(rows[0]![0]).toEqual({ ch: "█", color: "#000000" });
  expect(rows[0]![33]).toEqual({ ch: "▀", color: "#ffffff" });
  expect(rows[0]![16]).toEqual({ ch: " ", color: "#7c7c7c" });
  expect(rows[4]![16]).toEqual({ ch: " ", color: "#7c7c7c" });
  expect(
    rows[4]!
      .slice(28)
      .map((cell) => cell.ch)
      .join(""),
  ).toBe("██▄▄▄▄");
});

test("adjacent cells of the same color become one text segment without losing spaces", () => {
  expect(
    mergeColoredCells([
      { ch: "█", color: "#112233" },
      { ch: " ", color: "#112233" },
      { ch: "▀", color: "#112233" },
      { ch: "▄", color: "#445566" },
      { ch: "█", color: "#445566" },
      { ch: "█", color: "#112233" },
    ]),
  ).toEqual([
    { text: "█ ▀", color: "#112233" },
    { text: "▄█", color: "#445566" },
    { text: "█", color: "#112233" },
  ]);
});

test("wide header paints the anime avatar beside the name and separate model, effort and cwd rows without tips", async () => {
  const terminal = createTerminal(80, 24);
  const app = renderSync(
    <ThemeProvider theme={{ ...dark, logoFrom: "#112233", logoTo: "#445566", subtle: "#778899" }}>
      <Logo model="local/model" thinking="high" cwd="/project" working />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[3]?.slice(42)).toBe("██▀▀▄▄ ██  ██ ██  ██ ▀▀██▀▀ ██▀▀▀▀");
    expect(terminal.screen()[9]?.slice(42)).toBe("local/model · 推理强度：高");
    expect(terminal.screen()[10]?.slice(42)).toBe("/project");
    expect(terminal.screen().join("\n")).not.toMatch(/提示|Tip:|\/tips/);
    const buffer = terminal.terminal.buffer.active;
    const cell = (x: number, y: number) => buffer.getLine(buffer.viewportY + y)!.getCell(x)!;
    expect(cell(42, 3).getFgColor()).toBe(0x112233);
    expect(cell(75, 3).getFgColor()).toBe(0x445566);
    expect(cell(42, 10).getFgColor()).toBe(0x778899);
    const colors = new Set<number>();
    for (let y = 0; y < 14; y++)
      for (let x = 0; x < 40; x++) {
        const pixel = cell(x, y);
        if (pixel.isFgRGB()) colors.add(pixel.getFgColor());
        if (pixel.isBgRGB()) colors.add(pixel.getBgColor());
      }
    expect(colors.has(0xe85693)).toBe(true);
    expect(cell(15, 7).getChars()).toBe("▀");
    expect(cell(15, 7).getFgColor()).toBe(0xfff8ee);
    expect(cell(15, 7).getBgColor()).toBe(0xffe6dc);
    expect(cell(0, 5).isBgDefault()).toBe(true);
    expect(cell(42, 9).isBgDefault()).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("narrow and short headers keep metadata readable and clear the avatar on resize", async () => {
  const terminal = createTerminal(80, 24);
  const app = renderSync(<Logo model="local/model" cwd="/project" working />, terminal);
  try {
    await terminal.flush();
    terminal.resize(40, 24);
    await terminal.waitFor(() => terminal.screen()[7] === "local/model");
    expect(terminal.screen()[8]).toBe("/project");
    expect(terminal.screen()[0]).toBe("Rukie");
    expect(terminal.screen()[9]).toBe("");
    const buffer = terminal.terminal.buffer.active;
    expect(
      buffer
        .getLine(buffer.viewportY + 5)!
        .getCell(13)!
        .isBgDefault(),
    ).toBe(true);
    terminal.resize(40, 12);
    await terminal.waitFor(() => terminal.screen()[1] === "local/model");
    expect(terminal.screen().slice(0, 4)).toEqual(["Rukie", "local/model", "/project", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("avatar blinks and nods, then permanently freezes on the first Run and releases timers", async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(80, 24, (ms) => jest.advanceTimersByTime(ms));
  let update = (_running: boolean) => {};
  function View() {
    const [running, setRunning] = useState(false);
    useLayoutEffect(() => {
      update = setRunning;
    }, []);
    return <Logo model="local/model" cwd="/project" working={running} />;
  }
  let app!: ReturnType<typeof renderSync>;
  act(() => {
    app = renderSync(<View />, terminal);
  });
  const flush = async () => {
    const pending = terminal.flush();
    jest.advanceTimersByTime(0);
    await pending;
  };
  const advance = async (ms: number) => {
    act(() => jest.advanceTimersByTime(ms));
    jest.advanceTimersByTime(16);
    await flush();
  };
  const cell = (x: number, y: number) => terminal.terminal.buffer.active.getLine(y)!.getCell(x)!;
  try {
    await flush();
    expect(cell(15, 7).getFgColor()).toBe(0xfff8ee);
    const metadata = terminal
      .screen()
      .slice(9, 11)
      .map((row) => row.slice(42));
    await advance(400);
    expect(cell(15, 7).getFgColor()).toBe(0x42283e);
    await advance(160);
    expect(cell(15, 7).getFgColor()).toBe(0xfff8ee);
    await advance(240);
    expect(cell(18, 0).getChars()).toBe(" ");
    expect(
      terminal
        .screen()
        .slice(9, 11)
        .map((row) => row.slice(42)),
    ).toEqual(metadata);
    act(() => update(true));
    jest.advanceTimersByTime(16);
    await flush();
    expect(cell(18, 0).getChars()).toBe("▄");
    expect(jest.getTimerCount()).toBe(0);
    act(() => update(false));
    await advance(16);
    const output = terminal.output();
    await advance(10000);
    expect(terminal.output()).toBe(output);
    expect(jest.getTimerCount()).toBe(0);
    act(() => app.unmount());
    await app.waitUntilExit();
    const flushed = terminal.flush();
    jest.advanceTimersByTime(0);
    await flushed;
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    act(() => app.unmount());
    jest.useRealTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    app.cleanup();
    terminal.dispose();
  }
});

test("removing the welcome header cancels its pending animation", async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(80, 24, (ms) => jest.advanceTimersByTime(ms));
  let app!: ReturnType<typeof renderSync>;
  act(() => {
    app = renderSync(<Logo model="local/model" cwd="/project" />, terminal);
  });
  try {
    const pending = terminal.flush();
    jest.advanceTimersByTime(0);
    await pending;
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    act(() => app.unmount());
    await app.waitUntilExit();
    const flushed = terminal.flush();
    jest.advanceTimersByTime(0);
    await flushed;
    expect(jest.getTimerCount()).toBe(0);
    const output = terminal.output();
    jest.advanceTimersByTime(10000);
    expect(terminal.output()).toBe(output);
  } finally {
    act(() => app.unmount());
    jest.useRealTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    app.cleanup();
    terminal.dispose();
  }
});

test("settled welcome animation rests between idle blinks and nods, and stops when hidden", async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(80, 24, (ms) => jest.advanceTimersByTime(ms));
  let app!: ReturnType<typeof renderSync>;
  act(() => {
    app = renderSync(<Logo model="local/model" cwd="/project" />, terminal);
  });
  const flush = async () => {
    const pending = terminal.flush();
    jest.advanceTimersByTime(0);
    await pending;
  };
  const advance = async (ms: number) => {
    act(() => jest.advanceTimersByTime(ms));
    jest.advanceTimersByTime(16);
    await flush();
  };
  const cell = (x: number, y: number) => terminal.terminal.buffer.active.getLine(y)!.getCell(x)!;
  try {
    await flush();
    await advance(1920);
    const resting = terminal.output();
    await advance(3000);
    expect(terminal.output()).toBe(resting);
    await advance(600);
    expect(cell(15, 7).getFgColor()).toBe(0x42283e);
    await advance(350);
    expect(cell(15, 7).getFgColor()).toBe(0xfff8ee);
    await advance(1000);
    expect(cell(18, 0).getChars()).toBe(" ");
    await advance(500);
    expect(cell(18, 0).getChars()).toBe("▄");
    expect(jest.getTimerCount()).toBe(1);
    act(() => terminal.resize(40, 24));
    await advance(16);
    expect(jest.getTimerCount()).toBe(0);
    const hidden = terminal.output();
    await advance(10000);
    expect(terminal.output()).toBe(hidden);
  } finally {
    act(() => app.unmount());
    jest.useRealTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    app.cleanup();
    terminal.dispose();
  }
});

test("Kitty header uploads the full-resolution portrait and removes it on resize and exit", async () => {
  const terminal = createTerminal(80, 24);
  const app = renderSync(
    <AlternateScreen>
      <Logo model="local/model" cwd="/project" working />
    </AlternateScreen>,
    {
      ...terminal,
      terminalImages: true,
    },
  );
  try {
    await terminal.flush();
    await terminal.waitFor(() => terminal.output().includes("a=q"));
    terminal.stdin.write("\x1b_Gi=31;OK\x1b\\\x1b[6;20;10t\x1b[4;480;800t\x1b[?1;2c");
    await terminal.waitFor(() => terminal.output().includes("a=t,"));
    // Native Kitty uploads the bounded decoded RGBA snapshot with zlib compression.
    expect(terminal.output()).toContain("f=32");
    expect(terminal.output()).toContain("o=z");
    expect(terminal.output()).toContain("a=p,");
    expect(terminal.screen()[9]?.slice(42)).toBe("local/model");
    expect(terminal.screen()[10]?.slice(42)).toBe("/project");
    const buffer = terminal.terminal.buffer.active;
    expect(buffer.getLine(7)!.getCell(15)!.isBgDefault()).toBe(true);
    const placements = () =>
      // oxlint-disable-next-line no-control-regex -- Parse actual native Kitty placement headers.
      Array.from(terminal.output().matchAll(/\x1b_G(a=p,[^;]*);/g), (match) =>
        Object.fromEntries(match[1]!.split(",").map((field) => field.split("="))),
      );
    const original = placements().at(-1)!;
    const beforeResize = placements().length;
    terminal.resize(40, 24);
    await terminal.waitFor(() => terminal.screen()[7] === "local/model");
    expect(terminal.output()).toContain("a=d");
    expect(terminal.screen()[8]).toBe("/project");
    const returnOffset = terminal.output().length;
    terminal.resize(80, 24);
    await terminal.waitFor(() => placements().length > beforeResize);
    const restored = placements().at(-1)!;
    // Resize invalidates terminal-side pixels; the same resource gets a fresh placement.
    expect(restored.i).toBe(original.i);
    expect(restored.p).not.toBe(original.p);
    expect([restored.c, restored.r]).toEqual([original.c, original.r]);
    const uploadHeaders = Array.from(
      terminal
        .output()
        .slice(returnOffset)
        // oxlint-disable-next-line no-control-regex -- Observe real Kitty headers for the restored resource.
        .matchAll(/\x1b_G(a=t,[^;]*);/g),
    );
    expect(
      uploadHeaders.filter((match) => match[1]!.split(",").includes(`i=${restored.i}`)),
    ).toHaveLength(1);
    app.unmount();
    await app.waitUntilExit();
    await terminal.flush();
    expect(terminal.output().lastIndexOf("a=d")).toBeLessThan(
      terminal.output().lastIndexOf("?1049l"),
    );
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
