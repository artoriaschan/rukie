import { expect, jest, test } from "bun:test";
import { act, useLayoutEffect, useState } from "react";
import { Spinner, Text, render } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("Spinner animates and releases its interval when removed from a mounted tree", async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(10, 3);
  let remove = () => {};
  function View() {
    const [visible, setVisible] = useState(true);
    useLayoutEffect(() => {
      remove = () => setVisible(false);
    }, []);
    return visible ? <Spinner color="cyan" /> : <Text>done</Text>;
  }
  let app!: ReturnType<typeof render>;
  act(() => {
    app = render(<View />, terminal);
  });
  const flush = async () => {
    const flushed = terminal.flush();
    jest.advanceTimersByTime(0);
    await flushed;
  };
  try {
    await flush();
    const first = terminal.screen()[0];
    expect(first).toBe("⠋");
    act(() => jest.advanceTimersByTime(80));
    jest.advanceTimersByTime(16);
    await flush();
    expect(terminal.screen()[0]).not.toBe(first);
    expect(terminal.screen()[0]).toBe("⠙");
    expect(terminal.terminal.buffer.active.getLine(0)!.getCell(0)!.getFgColor()).toBe(6);
    act(() => remove());
    jest.advanceTimersByTime(16);
    await flush();
    expect(terminal.screen()[0]).toBe("done");
    expect(jest.getTimerCount()).toBe(0);
    const before = terminal.writes.length;
    jest.advanceTimersByTime(800);
    await flush();
    expect(terminal.writes.length).toBe(before);
    act(() => app.unmount());
    await app.waitUntilExit();
  } finally {
    act(() => app.unmount());
    jest.useRealTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    terminal.dispose();
  }
});

test("Spinner cycles custom frames in order and preserves Text styles", async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(10, 3);
  let app!: ReturnType<typeof render>;
  act(() => {
    app = render(<Spinner frames={["·", "•", "●", "•"]} bold inverse italic />, terminal);
  });
  const flush = async () => {
    const flushed = terminal.flush();
    jest.advanceTimersByTime(0);
    await flushed;
  };
  try {
    act(() => jest.advanceTimersByTime(16));
    await flush();
    expect(terminal.screen()[0]).toBe("·");
    for (const frame of ["•", "●", "•", "·", "•"]) {
      act(() => jest.advanceTimersByTime(64));
      jest.advanceTimersByTime(16);
      await flush();
      expect(terminal.screen()[0]).toBe(frame);
      const cell = terminal.terminal.buffer.active.getLine(0)!.getCell(0)!;
      expect(cell.isBold()).toBeTruthy();
      expect(cell.isInverse()).toBeTruthy();
      expect(cell.isItalic()).toBeTruthy();
    }
  } finally {
    act(() => app.unmount());
    await app.waitUntilExit();
    jest.useRealTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    terminal.dispose();
  }
});
