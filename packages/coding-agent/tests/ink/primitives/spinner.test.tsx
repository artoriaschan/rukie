import { expect, test } from "bun:test";
import FakeTimers from "@sinonjs/fake-timers";
import { act, useLayoutEffect, useState } from "react";
import { Spinner, Text, renderSync as render } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("Spinner animates and releases its interval when removed from a mounted tree", async () => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(10, 3, (ms) => act(() => clock.tick(ms)));
  let remove = () => {};
  function View() {
    const [visible, setVisible] = useState(true);
    useLayoutEffect(() => {
      remove = () => setVisible(false);
    }, []);
    return visible ? <Spinner color="ansi:cyan" /> : <Text>done</Text>;
  }
  let app!: ReturnType<typeof render>;
  act(() => {
    app = render(<View />, terminal);
  });
  const flush = () => terminal.flush();
  try {
    await flush();
    const first = terminal.screen()[0];
    expect(first).toBe("⠋");
    act(() => clock.tick(80));
    act(() => clock.tick(16));
    await flush();
    expect(terminal.screen()[0]).not.toBe(first);
    expect(terminal.screen()[0]).toBe("⠙");
    expect(terminal.terminal.buffer.active.getLine(0)!.getCell(0)!.getFgColor()).toBe(6);
    act(() => remove());
    act(() => clock.tick(16));
    await flush();
    expect(terminal.screen()[0]).toBe("done");
    expect(clock.countTimers()).toBe(0);
    const before = terminal.writes.length;
    act(() => clock.tick(800));
    await flush();
    expect(terminal.writes.length).toBe(before);
    act(() => app.unmount());
    await app.waitUntilExit();
    app.cleanup();
  } finally {
    act(() => app.unmount());
    await app.waitUntilExit();
    app.cleanup();
    clock.uninstall();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    terminal.dispose();
  }
});

test("Spinner cycles custom frames in order and preserves Text styles", async () => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(10, 3, (ms) => act(() => clock.tick(ms)));
  let app!: ReturnType<typeof render>;
  act(() => {
    app = render(<Spinner frames={["·", "•", "●", "•"]} bold inverse italic />, terminal);
  });
  const flush = () => terminal.flush();
  try {
    act(() => clock.tick(16));
    await flush();
    expect(terminal.screen()[0]).toBe("·");
    for (const frame of ["•", "●", "•", "·", "•"]) {
      act(() => clock.tick(64));
      act(() => clock.tick(16));
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
    app.cleanup();
    clock.uninstall();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    terminal.dispose();
  }
});
