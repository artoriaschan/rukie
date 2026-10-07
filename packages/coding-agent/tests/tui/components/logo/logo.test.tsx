import { expect, jest, test } from "bun:test";
import { act, useLayoutEffect, useState } from "react";
import { dark, render, ThemeProvider } from "../../../../src/ink/index.ts";
import { Logo, mergeColoredCells, renderBigText } from "../../../../src/tui/components/logo";
import { createTerminal } from "../../helpers/terminal";

test("NEANT is five rows with the horizontal gradient reaching both colored edge columns", () => {
  const rows = renderBigText("NEANT", "#000000", "#ffffff");
  expect(rows).toHaveLength(5);
  expect(rows.map((row) => row.length)).toEqual([34, 34, 34, 34, 34]);
  expect(rows[0]![0]).toEqual({ ch: "█", color: "#000000" });
  expect(rows[0]![33]).toEqual({ ch: "▀", color: "#ffffff" });
  expect(rows[0]![16]).toEqual({ ch: "▀", color: "#7c7c7c" });
  expect(rows[4]![16]).toEqual({ ch: " ", color: "#7c7c7c" });
  expect(
    rows[4]!
      .slice(28)
      .map((cell) => cell.ch)
      .join(""),
  ).toBe("  ██  ");
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

test("wide header paints the ghost beside the name and separate model, effort and cwd rows without tips", async () => {
  const terminal = createTerminal(80, 24);
  const app = render(
    <ThemeProvider theme={{ ...dark, logoFrom: "#112233", logoTo: "#445566", subtle: "#778899" }}>
      <Logo model="local/model" thinking="high" cwd="/project" working />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[3]?.slice(42)).toBe("██  ██ ██▀▀▀▀  ▄▀▀▄  ██  ██ ▀▀██▀▀");
    expect(terminal.screen()[9]?.slice(42)).toBe("local/model · 推理强度：高");
    expect(terminal.screen()[10]?.slice(42)).toBe("/project");
    expect(terminal.screen().join("\n")).not.toMatch(/提示|Tip:|\/tips/);
    const buffer = terminal.terminal.buffer.active;
    const cell = (x: number, y: number) => buffer.getLine(buffer.viewportY + y)!.getCell(x)!;
    expect(cell(42, 3).getFgColor()).toBe(0x112233);
    expect(cell(75, 3).getFgColor()).toBe(0x445566);
    expect(cell(42, 10).getFgColor()).toBe(0x778899);
    expect(cell(13, 5).getChars()).toBe("▀");
    expect(cell(13, 5).getFgColor()).toBe(0xffffff);
    expect(cell(13, 5).getBgColor()).toBe(0xedf5ff);
    expect(cell(0, 5).isBgDefault()).toBe(true);
    expect(cell(42, 9).isBgDefault()).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("narrow and short headers keep metadata readable and clear the ghost on resize", async () => {
  const terminal = createTerminal(80, 24);
  const app = render(<Logo model="local/model" cwd="/project" working />, terminal);
  try {
    await terminal.flush();
    terminal.resize(40, 24);
    await terminal.waitFor(() => terminal.screen()[7] === "local/model");
    expect(terminal.screen()[8]).toBe("/project");
    expect(terminal.screen()[0]).toBe("Neant");
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
    expect(terminal.screen().slice(0, 4)).toEqual(["Neant", "local/model", "/project", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("ghost blinks and floats, then permanently freezes on the first Run and releases timers", async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(80, 24);
  let update = (_running: boolean) => {};
  function View() {
    const [running, setRunning] = useState(false);
    useLayoutEffect(() => {
      update = setRunning;
    }, []);
    return <Logo model="local/model" cwd="/project" working={running} />;
  }
  let app!: ReturnType<typeof render>;
  act(() => {
    app = render(<View />, terminal);
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
    expect(cell(13, 5).getFgColor()).toBe(0xffffff);
    const metadata = terminal
      .screen()
      .slice(9, 11)
      .map((row) => row.slice(42));
    await advance(400);
    expect(cell(13, 5).getFgColor()).toBe(0xadc8ee);
    await advance(160);
    expect(cell(13, 5).getFgColor()).toBe(0xffffff);
    await advance(240);
    expect(cell(20, 0).getChars()).toBe("▀");
    expect(
      terminal
        .screen()
        .slice(9, 11)
        .map((row) => row.slice(42)),
    ).toEqual(metadata);
    act(() => update(true));
    jest.advanceTimersByTime(16);
    await flush();
    expect(cell(20, 0).getChars()).toBe("▄");
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
    terminal.dispose();
  }
});

test("removing the welcome header cancels its pending animation", async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(80, 24);
  let app!: ReturnType<typeof render>;
  act(() => {
    app = render(<Logo model="local/model" cwd="/project" />, terminal);
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
    terminal.dispose();
  }
});

test("settled welcome animation rests between idle blinks and floats, and stops when hidden", async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(80, 24);
  let app!: ReturnType<typeof render>;
  act(() => {
    app = render(<Logo model="local/model" cwd="/project" />, terminal);
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
    expect(cell(13, 5).getFgColor()).toBe(0xadc8ee);
    await advance(350);
    expect(cell(13, 5).getFgColor()).toBe(0xffffff);
    await advance(1000);
    expect(cell(20, 0).getChars()).toBe("▀");
    await advance(500);
    expect(cell(20, 0).getChars()).toBe("▄");
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
    terminal.dispose();
  }
});
