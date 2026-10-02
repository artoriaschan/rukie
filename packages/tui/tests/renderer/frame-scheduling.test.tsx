import { expect, jest, test } from "bun:test";
import { act, useLayoutEffect, useState } from "react";
import { Box, Static, Text, render } from "../../src";
import { createTerminal } from "../helpers/terminal";

test("separate React commits in one 16ms window write only the latest frame", async () => {
  const terminal = createTerminal(12, 3);
  let update = (_text: string) => {};
  let committed = "";
  function View() {
    const [text, setText] = useState("initial");
    useLayoutEffect(() => {
      update = setText;
      committed = text;
    });
    return <Text>{text}</Text>;
  }
  const app = render(<View />, terminal);
  const commit = async (text: string) => {
    act(() => update(text));
    expect(committed).toBe(text);
  };
  const flush = async () => {
    const flushed = terminal.flush();
    jest.advanceTimersByTime(0);
    await flushed;
  };
  try {
    await terminal.flush();
    jest.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const before = terminal.writes.length;
    await commit("first");
    jest.advanceTimersByTime(5);
    await commit("second");
    jest.advanceTimersByTime(10);
    await commit("latest");
    expect(terminal.writes.length).toBe(before);
    jest.advanceTimersByTime(1);
    await flush();
    expect(terminal.writes.length).toBe(before + 1);
    expect(terminal.screen()).toEqual(["latest", "", ""]);
    await commit("pending");
    act(() => app.unmount());
    const afterUnmount = terminal.writes.length;
    jest.advanceTimersByTime(16);
    await flush();
    expect(terminal.writes.length).toBe(afterUnmount);
  } finally {
    act(() => app.unmount());
    await app.waitUntilExit();
    jest.useRealTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    terminal.dispose();
  }
});

test("Static items from intermediate commits survive coalescing in their original order", async () => {
  const terminal = createTerminal(10, 3);
  let update = (_items: string[]) => {};
  function View() {
    const [items, setItems] = useState<string[]>([]);
    useLayoutEffect(() => {
      update = setItems;
    }, []);
    return (
      <Box flexDirection="column">
        <Static>
          {items.map((item) => (
            <Text key={item}>{item}</Text>
          ))}
        </Static>
        <Text>active</Text>
      </Box>
    );
  }
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    jest.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const before = terminal.writes.length;
    act(() => update(["first", "second"]));
    jest.advanceTimersByTime(5);
    act(() => update(["first", "second", "third"]));
    jest.advanceTimersByTime(11);
    const flushed = terminal.flush();
    jest.advanceTimersByTime(0);
    await flushed;
    expect(terminal.writes.length).toBe(before + 1);
    expect(terminal.scrollback()).toEqual(["first", "second"]);
    expect(terminal.screen()).toEqual(["third", "active", ""]);
  } finally {
    act(() => app.unmount());
    await app.waitUntilExit();
    jest.useRealTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    terminal.dispose();
  }
});
