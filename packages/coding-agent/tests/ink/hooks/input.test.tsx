import { expect, test } from "bun:test";
import { setImmediate } from "node:timers/promises";
import {
  AlternateScreen,
  Box,
  Text,
  renderSync,
  useInput,
  type InputEvent,
} from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";
import { testClock } from "../../tui/helpers/test-clock";

async function inputProbe(
  run: (events: InputEvent[], write: (bytes: string | Buffer) => Promise<void>) => Promise<void>,
) {
  testClock.useFakeTimers();
  const terminal = createTerminal(40, 6, testClock.advanceTimersByTime);
  const events: InputEvent[] = [];
  function View() {
    useInput((_input, _key, event) => events.push(event));
    return (
      <AlternateScreen>
        <Text>input-ready</Text>
      </AlternateScreen>
    );
  }
  const app = renderSync(<View />, terminal);
  async function write(bytes: string | Buffer) {
    await new Promise<void>((resolve, reject) =>
      terminal.stdin.write(bytes, (error) => (error ? reject(error) : resolve())),
    );
    const deadline = process.hrtime.bigint() + 1_000_000_000n;
    do {
      await setImmediate();
      if (terminal.stdin.readableLength === 0) return;
    } while (process.hrtime.bigint() < deadline);
    throw new Error("stdin did not consume bytes at frozen frontend time");
  }
  try {
    await terminal.flush();
    expect(terminal.stdin.isRaw).toBe(true);
    await run(events, write);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    expect(terminal.stdin.isRaw).toBe(false);
    terminal.dispose();
    testClock.useRealTimers();
  }
}

const keys = (events: InputEvent[]) =>
  events.map((event) => [
    event.input,
    event.keypress.name,
    event.key.ctrl,
    event.key.shift,
    event.isPasted,
  ]);

test("stdin bytes deliver characters, common keys and a fragmented paste as whole events", () =>
  inputProbe(async (events, write) => {
    await write("a\x1b[A\x1b[B\x1b[C\x1b[D\r\x1b[13;2u\x7f\x1b[3~\x03");
    const chinese = Buffer.from("中");
    await write(chinese.subarray(0, 1));
    expect(events).toHaveLength(10);
    await write(chinese.subarray(1));
    await write("\x1b[20");
    await write("0~one\n中\r\x1b[A\x1b[20");
    expect(events.filter((event) => event.isPasted)).toHaveLength(0);
    await write("1~");
    expect(keys(events)).toEqual([
      ["a", "a", false, false, false],
      ...["up", "down", "right", "left", "return"].map((name) => ["", name, false, false, false]),
      ["return", "return", false, true, false],
      ...["backspace", "delete"].map((name) => ["", name, false, false, false]),
      ["c", "c", true, false, false],
      ["中", "", false, false, false],
      ["one\n中\r\x1b[A", "", false, false, true],
    ]);
    expect(events[11]!.key.return).toBe(false);
    expect(events[11]!.key.upArrow).toBe(false);
  }));

test("bare Escape is absent at49ms and present at the native50ms deadline", () =>
  inputProbe(async (events, write) => {
    const now = Date.now();
    await write("\x1b");
    testClock.advanceTimersByTime(49);
    await setImmediate();
    expect(Date.now()).toBe(now + 49);
    expect(events).toHaveLength(0);
    testClock.advanceTimersByTime(1);
    await setImmediate();
    expect(Date.now()).toBe(now + 50);
    expect(
      events.map((event) => [
        event.input,
        event.key.escape,
        event.key.meta,
        event.keypress.meta,
        event.keypress.option,
      ]),
    ).toEqual([["", true, true, false, false]]);
  }));

test("delayed escape fragments keep paste atomic, and common Shift+Enter encodings preserve modifiers", () =>
  inputProbe(async (events, write) => {
    await write("\x1b[20");
    testClock.advanceTimersByTime(40);
    await setImmediate();
    expect(events).toHaveLength(0);
    await write("0~first\nsecond\x1b[201~\x1b[27;2;13~\x1b[13;2~\x1b[1;5D\x1b[?999hX");
    // A complete unknown protocol token may have an empty callback; it never becomes prompt text or Escape.
    expect(keys(events).filter((row) => row[1] !== "" || row[0] !== "")).toEqual([
      ["first\nsecond", "", false, false, true],
      ["return", "return", false, true, false],
      ["", "f3", false, true, false],
      ["", "left", true, false, false],
      ["X", "x", false, true, false],
    ]);
    expect(events.some((event) => event.key.escape)).toBe(false);
  }));

test("Kitty and modifyOtherKeys Escape reach public frontend handlers", () =>
  inputProbe(async (events, write) => {
    await write("\x1b[27u\x1b[27;1;27~");
    expect(events.map((event) => [event.input, event.key.escape, event.keypress.name])).toEqual([
      ["", true, "escape"],
      ["", true, "escape"],
    ]);
  }));

test("same-chunk C0 and DEL preserve printable/control input order", () =>
  inputProbe(async (events, write) => {
    await write("a\rb\bB\x7fc\x03Z");
    expect(keys(events)).toEqual([
      ["a", "a", false, false, false],
      ["", "return", false, false, false],
      ["b", "b", false, false, false],
      ["", "backspace", false, false, false],
      ["B", "b", false, true, false],
      ["", "backspace", false, false, false],
      ["c", "c", false, false, false],
      ["c", "c", true, false, false],
      ["Z", "z", false, true, false],
    ]);
  }));

test("an incomplete bracketed paste stays atomic across its native500ms parser flush", () =>
  inputProbe(async (events, write) => {
    const now = Date.now();
    await write("\x1b[200~line\n\r\x1b[A中");
    testClock.advanceTimersByTime(499);
    await setImmediate();
    expect(Date.now()).toBe(now + 499);
    expect(events).toHaveLength(0);
    testClock.advanceTimersByTime(1);
    await setImmediate();
    expect(Date.now()).toBe(now + 500);
    expect(
      events.map((event) => [event.input, event.isPasted, event.key.return, event.key.upArrow]),
    ).toEqual([]);
    await write("\x1b[201~");
    expect(
      events.map((event) => [event.input, event.isPasted, event.key.return, event.key.upArrow]),
    ).toEqual([["line\n\r\x1b[A中", true, false, false]]);
    await write("X");
    expect(events.at(-1)!.input).toBe("X");
    expect(events.at(-1)!.isPasted).toBe(false);
  }));

test("fragmented SGR motion uses native pointer coordinates while clicks, drag and wheel remain distinct", async () => {
  const terminal = createTerminal(20, 6);
  const hover: number[][] = [];
  const clicks: number[][] = [];
  const wheels: number[][] = [];
  const drag: string[] = [];
  function Admission() {
    useInput(() => {});
    return null;
  }
  const app = renderSync(
    <AlternateScreen>
      <Admission />
      <Box
        width={10}
        height={4}
        flexDirection="column"
        onClick={(event) => clicks.push([event.col, event.row, event.localCol, event.localRow])}
        onWheel={(event) =>
          wheels.push([
            event.col,
            event.row,
            event.deltaY,
            Number(event.shift),
            Number(event.alt),
            Number(event.ctrl),
          ])
        }
        onDragStart={() => drag.push("start")}
        onDragMove={() => drag.push("move")}
        onDragEnd={() => drag.push("end")}
      >
        {["top", "bottom"].map((label) => (
          <Box
            key={label}
            width={10}
            height={2}
            flexShrink={0}
            onMouseEnter={(event) =>
              hover.push([
                event.col,
                event.row,
                Number(event.shift),
                Number(event.alt),
                Number(event.ctrl),
              ])
            }
          >
            <Text>{label}</Text>
          </Box>
        ))}
      </Box>
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[<35;4;");
    await setImmediate();
    expect(hover).toHaveLength(0);
    terminal.stdin.write("2M\x1b[<63;5;3M");
    await setImmediate();
    expect(hover.slice(0, 2)).toEqual([
      [3, 1, 0, 0, 0],
      [4, 2, 1, 1, 1],
    ]);
    terminal.stdin.write("\x1b[<0;4;2M\x1b[<0;4;2m");
    await setImmediate();
    expect(clicks).toEqual([[3, 1, 3, 1]]);
    terminal.stdin.write("\x1b[<0;4;2M\x1b[<32;7;2M\x1b[<32;8;3M\x1b[<0;8;3m");
    await setImmediate();
    expect(drag).toEqual(["start", "move", "move", "end"]);
    expect(clicks).toHaveLength(1);
    terminal.stdin.write("\x1b[<64;4;2M\x1b[<65;4;2M\x1b[<93;4;2M");
    await setImmediate();
    expect(wheels).toEqual([
      [3, 1, -3, 0, 0, 0],
      [3, 1, 3, 0, 0, 0],
      [3, 1, 3, 1, 1, 1],
    ]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("an orphan left release cannot replay an earlier valid click", async () => {
  const terminal = createTerminal(12, 4);
  let clicks = 0;
  function Screen() {
    useInput(() => {});
    return (
      <AlternateScreen>
        <Box width={12} height={2} onClick={() => clicks++}>
          <Text>button</Text>
        </Box>
      </AlternateScreen>
    );
  }
  const app = renderSync(<Screen />, terminal);
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[<0;4;1m");
    await setImmediate();
    expect(clicks).toBe(0);
    terminal.stdin.write("\x1b[<0;4;1M\x1b[<0;4;1m");
    await setImmediate();
    expect(clicks).toBe(1);
    terminal.stdin.write("\x1b[<0;4;1m");
    await setImmediate();
    expect(clicks).toBe(1);
    terminal.stdin.write("x\x1b[<0;4;1M\x1b[<0;4;1m");
    await setImmediate();
    expect(clicks).toBe(2);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
