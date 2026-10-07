import { expect, test } from "bun:test";
import FakeTimers from "@sinonjs/fake-timers";
import { act, useLayoutEffect, useState } from "react";
import { ClockProvider, Text, renderSync as render, useAnimationFrame } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("animation subscribers share one timer and release it when the last subscriber leaves", async () => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(30, 3, (ms) => act(() => clock.tick(ms)));
  let setVisible = (_count: number) => {};
  function Frame() {
    const [ref, time] = useAnimationFrame(80);
    return <Text ref={ref}>{time} </Text>;
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
  const flush = () => terminal.flush();
  try {
    act(() => {
      app = render(<View />, terminal);
    });
    await flush();
    expect(terminal.screen()[0]).toBe("0 0");
    act(() => clock.tick(80));
    act(() => clock.tick(16));
    await flush();
    expect(terminal.screen()[0]).toBe("80 80");
    act(() => setVisible(1));
    act(() => clock.tick(16));
    await flush();
    act(() => setVisible(0));
    act(() => clock.tick(16));
    await flush();
    expect(clock.countTimers()).toBe(0);
  } finally {
    if (app) {
      act(() => app.unmount());
      await app.waitUntilExit();
      app.cleanup();
    }
    clock.uninstall();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    terminal.dispose();
  }
});

test("animation intervals throttle independently, null freezes time, and subscriptions can resume", async () => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const terminal = createTerminal(30, 3, (ms) => act(() => clock.tick(ms)));
  let change = (_intervals: (number | null)[]) => {};
  function Frame({ interval }: { interval: number | null }) {
    const [ref, time] = useAnimationFrame(interval);
    return <Text ref={ref}>{time} </Text>;
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
  const flush = () => terminal.flush();
  const advance = async (ms: number) => {
    act(() => clock.tick(ms));
    act(() => clock.tick(16));
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
    expect(Number(terminal.screen()[0]!.split(" ")[0])).toBeGreaterThanOrEqual(240);
    expect(terminal.screen()[0]!.split(" ").slice(1)).toEqual(["160", "0"]);
    act(() => change([null, null, null]));
    await advance(320);
    expect(clock.countTimers()).toBe(0);
    expect(Number(terminal.screen()[0]!.split(" ")[0])).toBeGreaterThanOrEqual(240);
    expect(terminal.screen()[0]!.split(" ").slice(1)).toEqual(["160", "0"]);
    act(() => change([80, 80, null]));
    await advance(80);
    // Resumed subscribers read elapsed time including the paused interval.
    const resumed = terminal.screen()[0]!.split(" ").map(Number);
    expect(resumed[0]).toBeGreaterThanOrEqual(672);
    expect(resumed[1]).toBeGreaterThanOrEqual(672);
    expect(resumed[2]).toBe(0);
    act(() => app.unmount());
    await flush();
    expect(clock.countTimers()).toBe(0);
  } finally {
    if (app) {
      act(() => app.unmount());
      await app.waitUntilExit();
      app.cleanup();
    }
    clock.uninstall();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    terminal.dispose();
  }
});
