import { expect, jest, test } from "bun:test";
import { act, useLayoutEffect, useState } from "react";
import { ClockProvider, Text, render, useAnimationFrame } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("animation subscribers share one timer and release it when the last subscriber leaves", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(0));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(30, 3);
  let setVisible = (_count: number) => {};
  function Frame() {
    const [, time] = useAnimationFrame(80);
    return <Text>{time} </Text>;
  }
  function View() {
    const [count, setCount] = useState(2);
    useLayoutEffect(() => {
      setVisible = setCount;
    }, []);
    return (
      <ClockProvider>
        <Text>
          {count > 0 && <Frame />}
          {count > 1 && <Frame />}
        </Text>
      </ClockProvider>
    );
  }
  let app!: ReturnType<typeof render>;
  const flush = async () => {
    const flushed = terminal.flush();
    jest.advanceTimersByTime(0);
    await flushed;
  };
  try {
    act(() => {
      app = render(<View />, terminal);
    });
    await flush();
    expect(terminal.screen()[0]).toBe("0 0");
    expect(jest.getTimerCount()).toBe(1);
    act(() => jest.advanceTimersByTime(80));
    jest.advanceTimersByTime(16);
    await flush();
    expect(terminal.screen()[0]).toBe("80 80");
    act(() => setVisible(1));
    jest.advanceTimersByTime(16);
    await flush();
    expect(jest.getTimerCount()).toBe(1);
    act(() => setVisible(0));
    jest.advanceTimersByTime(16);
    await flush();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    if (app) {
      act(() => app.unmount());
      await app.waitUntilExit();
    }
    jest.useRealTimers();
    jest.setSystemTime();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    terminal.dispose();
  }
});

test("animation intervals throttle independently, null freezes time, and subscriptions can resume", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(0));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(30, 3);
  let change = (_intervals: (number | null)[]) => {};
  function Frame({ interval }: { interval: number | null }) {
    const [, time] = useAnimationFrame(interval);
    return <Text>{time} </Text>;
  }
  function View() {
    const [intervals, setIntervals] = useState<(number | null)[]>([80, 160, null]);
    useLayoutEffect(() => {
      change = setIntervals;
    }, []);
    return (
      <Text>
        {intervals.map((interval, index) => (
          <Frame key={index} interval={interval} />
        ))}
      </Text>
    );
  }
  let app!: ReturnType<typeof render>;
  const flush = async () => {
    const flushed = terminal.flush();
    jest.advanceTimersByTime(0);
    await flushed;
  };
  const advance = async (ms: number) => {
    act(() => jest.advanceTimersByTime(ms));
    jest.advanceTimersByTime(16);
    await flush();
  };
  try {
    act(() => {
      app = render(<View />, terminal);
    });
    await flush();
    await advance(80);
    expect(terminal.screen()[0]).toBe("80 0 0");
    await advance(64);
    expect(terminal.screen()[0]).toBe("160 160 0");
    act(() => change([80, null, null]));
    await advance(64);
    expect(terminal.screen()[0]).toBe("240 160 0");
    act(() => change([null, null, null]));
    await advance(320);
    expect(jest.getTimerCount()).toBe(0);
    expect(terminal.screen()[0]).toBe("240 160 0");
    act(() => change([80, 80, null]));
    await advance(80);
    // Both resumed subscribers see the same elapsed clock, including the pause.
    const resumed = terminal.screen()[0]!.split(" ").map(Number);
    expect(resumed[0]).toBeGreaterThanOrEqual(672);
    expect(resumed[1]).toBe(resumed[0]);
    expect(resumed[2]).toBe(0);
    expect(jest.getTimerCount()).toBe(1);
    act(() => app.unmount());
    await flush();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    if (app) {
      act(() => app.unmount());
      await app.waitUntilExit();
    }
    jest.useRealTimers();
    jest.setSystemTime();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    terminal.dispose();
  }
});
