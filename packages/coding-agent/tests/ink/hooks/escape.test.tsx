import { expect, jest, test } from "bun:test";
import { useState } from "react";
import { Text, TextInput, render, useInput, type InputEvent } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test.each([
  { chunks: ["\x1b\x1b[<35;10;66M"], escapes: 1 },
  { chunks: ["\x1b\x1b\x1b[<35;10;66M"], escapes: 2 },
  { chunks: ["\x1b", "\x1b", "\x1b[<35;10;66M"], escapes: 2 },
  { chunks: ["\x1b", "\x1b\x1b[<35;10;", "66M"], escapes: 2 },
])("Escape followed by mouse motion never edits the prompt: %j", async ({ chunks, escapes }) => {
  const terminal = createTerminal();
  const events: InputEvent[] = [];
  const changes: string[] = [];
  function View() {
    useInput((event) => events.push(event));
    const [value, setValue] = useState("draft");
    return (
      <TextInput
        value={value}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
      />
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    await terminal.flush();
    for (const chunk of chunks) terminal.stdin.write(chunk);
    expect(events).toEqual([
      ...Array.from({ length: escapes }, (): InputEvent => ({
        type: "key",
        input: "",
        key: { name: "escape", ctrl: false, shift: false, alt: false },
      })),
      { type: "move", x: 9, y: 65, shift: false, alt: false, ctrl: false },
    ]);
    expect(changes).toEqual([]);
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("draft");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("double Escape retains the final Escape deadline and subsequent Alt and fragmented keys", async () => {
  jest.useFakeTimers();
  const terminal = createTerminal(20, 8, (ms) => jest.advanceTimersByTime(ms));
  const events: InputEvent[] = [];
  const escape: InputEvent = {
    type: "key",
    input: "",
    key: { name: "escape", ctrl: false, shift: false, alt: false },
  };
  function View() {
    useInput((event) => events.push(event));
    return <Text>ready</Text>;
  }
  const app = render(<View />, terminal);
  try {
    terminal.stdin.write("\x1b\x1b");
    expect(events).toEqual([escape]);
    jest.advanceTimersByTime(29);
    expect(events).toEqual([escape]);
    jest.advanceTimersByTime(1);
    expect(events).toEqual([escape, escape]);
    terminal.stdin.write("\x1bx\x1b\x1b[");
    jest.advanceTimersByTime(30);
    expect(events).toEqual([
      escape,
      escape,
      { type: "key", input: "x", key: { name: "x", ctrl: false, shift: false, alt: true } },
      escape,
    ]);
    terminal.stdin.write("A");
    expect(events.at(-1)).toEqual({
      type: "key",
      input: "",
      key: { name: "up", ctrl: false, shift: false, alt: false },
    });
    terminal.stdin.write("\x1b");
    app.unmount();
    await app.waitUntilExit();
    jest.advanceTimersByTime(30);
    expect(events).toHaveLength(5);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
    jest.useRealTimers();
  }
});
