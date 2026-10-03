import { expect, test } from "bun:test";
import { Text, render, useInput, type InputEvent } from "../../src";
import { createTerminal } from "../helpers/terminal";

test("fragmented SGR motion delivers cell coordinates while buttons and wheel remain distinct", async () => {
  const terminal = createTerminal();
  const events: InputEvent[] = [];
  function View() {
    useInput((event) => events.push(event));
    return <Text>ready</Text>;
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    terminal.stdin.write("\x1b[<35;4;");
    expect(events).toEqual([]);
    terminal.stdin.write("2M\x1b[<63;5;3M\x1b[<32;4;2M\x1b[<0;4;2M\x1b[<0;4;2m");
    terminal.stdin.write("\x1b[<64;4;2M\x1b[<65;4;2M");
    expect(events).toEqual([
      { type: "move", x: 3, y: 1 },
      { type: "move", x: 4, y: 2 },
      { type: "mouse", action: "press", button: 0, x: 3, y: 1 },
      { type: "mouse", action: "release", button: 0, x: 3, y: 1 },
      { type: "wheel", input: "", x: 3, y: 1, delta: -1 },
      { type: "wheel", input: "", x: 3, y: 1, delta: 1 },
    ]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("stdin bytes deliver characters, common keys and a fragmented paste as whole events", async () => {
  const terminal = createTerminal();
  const events: InputEvent[] = [];
  function View() {
    useInput((event) => events.push(event));
    return <Text>input</Text>;
  }
  const app = render(<View />, terminal);
  try {
    expect(terminal.stdin.isRaw).toBe(true);
    terminal.stdin.write("a\x1b[A\x1b[B\x1b[C\x1b[D\r\x1b[13;2u\x7f\x1b[3~\x03");
    const chinese = Buffer.from("中");
    terminal.stdin.write(chinese.subarray(0, 1));
    terminal.stdin.write(chinese.subarray(1));
    terminal.stdin.write("\x1b[20");
    terminal.stdin.write("0~one\n中\r\x1b[A\x1b[20");
    expect(events.filter((event) => event.type === "paste")).toHaveLength(0);
    terminal.stdin.write("1~");
    terminal.stdin.write("\x1b");
    await terminal.waitFor(() => events.length === 13);
    expect(events).toEqual([
      { type: "key", input: "a", key: { name: "a", ctrl: false, shift: false, alt: false } },
      ...["up", "down", "right", "left", "enter"].map<InputEvent>((name) => ({
        type: "key",
        input: "",
        key: { name, ctrl: false, shift: false, alt: false },
      })),
      { type: "key", input: "", key: { name: "enter", ctrl: false, shift: true, alt: false } },
      ...["backspace", "delete"].map<InputEvent>((name) => ({
        type: "key",
        input: "",
        key: { name, ctrl: false, shift: false, alt: false },
      })),
      { type: "key", input: "c", key: { name: "c", ctrl: true, shift: false, alt: false } },
      { type: "key", input: "中", key: { name: "中", ctrl: false, shift: false, alt: false } },
      { type: "paste", input: "one\n中\r\x1b[A" },
      { type: "key", input: "", key: { name: "escape", ctrl: false, shift: false, alt: false } },
    ]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("delayed escape fragments keep paste atomic, and common Shift+Enter encodings preserve modifiers", async () => {
  const terminal = createTerminal();
  const events: InputEvent[] = [];
  function View() {
    useInput((event) => events.push(event));
    return <Text>ready</Text>;
  }
  const app = render(<View />, terminal);
  try {
    terminal.stdin.write("\x1b[20");
    await Bun.sleep(40);
    terminal.stdin.write("0~first\nsecond\x1b[201~\x1b[27;2;13~\x1b[13;2~\x1b[1;5D\x1b[?999hX");
    expect(events).toEqual([
      { type: "paste", input: "first\nsecond" },
      { type: "key", input: "", key: { name: "enter", ctrl: false, shift: true, alt: false } },
      { type: "key", input: "", key: { name: "enter", ctrl: false, shift: true, alt: false } },
      { type: "key", input: "", key: { name: "left", ctrl: true, shift: false, alt: false } },
      { type: "key", input: "X", key: { name: "X", ctrl: false, shift: false, alt: false } },
    ]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});
