import { expect, test } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { useState } from "react";
import {
  AlternateScreen,
  Box,
  Text,
  TextInput,
  renderSync,
  useInput,
  type InputEvent,
} from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";
import { testClock } from "../../tui/helpers/test-clock";

async function probe(
  run: (
    events: InputEvent[],
    write: (bytes: string) => Promise<void>,
    terminal: ReturnType<typeof createTerminal>,
    close: () => Promise<void>,
  ) => Promise<void>,
  editor = false,
) {
  testClock.useFakeTimers();
  const terminal = createTerminal(20, 68, testClock.advanceTimersByTime);
  const events: InputEvent[] = [];
  const changes: string[] = [];
  const hovered: { col: number; row: number; shift: boolean; alt: boolean; ctrl: boolean }[] = [];
  function View() {
    useInput((_input, _key, event) => events.push(event));
    const [value, setValue] = useState("draft");
    return (
      <AlternateScreen>
        <Box
          width={20}
          height={68}
          flexDirection="column"
          onMouseEnter={(event) =>
            hovered.push({
              col: event.col,
              row: event.row,
              shift: event.shift,
              alt: event.alt,
              ctrl: event.ctrl,
            })
          }
        >
          {editor ? (
            <TextInput
              value={value}
              onChange={(next) => {
                changes.push(next);
                setValue(next);
              }}
            />
          ) : (
            <Text>ready</Text>
          )}
        </Box>
      </AlternateScreen>
    );
  }
  const app = renderSync(<View />, terminal);
  async function write(bytes: string) {
    await new Promise<void>((resolve, reject) =>
      terminal.stdin.write(bytes, (error) => (error ? reject(error) : resolve())),
    );
    const deadline = process.hrtime.bigint() + 1_000_000_000n;
    do {
      await setImmediate();
      if (!terminal.stdin.readableLength) return;
    } while (process.hrtime.bigint() < deadline);
    throw new Error("stdin did not consume Escape bytes at frozen frontend time");
  }
  const close = async () => {
    app.unmount();
    await app.waitUntilExit();
  };
  try {
    await terminal.waitFor(() => terminal.screen()[0] === (editor ? "draft" : "ready"));
    await run(events, write, terminal, close);
    expect(changes).toEqual([]);
    if (editor)
      expect(hovered).toEqual([{ col: 9, row: 65, shift: false, alt: false, ctrl: false }]);
  } finally {
    await close();
    app.cleanup();
    terminal.dispose();
    testClock.useRealTimers();
  }
}
const names = (events: InputEvent[]) => events.map((event) => event.keypress.name);

test.each([
  { chunks: ["\x1b\x1b[<35;10;66M"], escapes: 1 },
  { chunks: ["\x1b\x1b\x1b[<35;10;66M"], escapes: 2 },
  { chunks: ["\x1b", "\x1b", "\x1b[<35;10;66M"], escapes: 2 },
  { chunks: ["\x1b", "\x1b\x1b[<35;10;", "66M"], escapes: 2 },
])("Escape followed by mouse motion never edits the prompt: %j", ({ chunks, escapes }) =>
  probe(async (events, write, terminal) => {
    for (const chunk of chunks) await write(chunk);
    expect(names(events)).toEqual(Array.from({ length: escapes }, () => "escape"));
    expect(
      events.every((event) => !event.keypress.meta && !event.key.ctrl && !event.key.shift),
    ).toBe(true);
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("draft");
  }, true),
);

test("double Escape retains the native final Escape deadline and subsequent Alt and fragmented keys", () =>
  probe(async (events, write, terminal, close) => {
    await write("\x1b\x1b");
    expect(names(events)).toEqual(["escape"]);
    // Native raw Escape admission is 50ms; completed CSI reports remain independent.
    testClock.advanceTimersByTime(49);
    expect(names(events)).toEqual(["escape"]);
    testClock.advanceTimersByTime(1);
    expect(names(events)).toEqual(["escape", "escape"]);
    await write("\x1bx\x1b\x1b[");
    testClock.advanceTimersByTime(49);
    expect(names(events)).toEqual(["escape", "escape", "", "escape"]);
    expect(events[2]!.key.meta).toBe(true);
    expect(events[2]!.input).toBe("x");
    await write("A");
    expect(events.at(-1)!.key.upArrow).toBe(true);
    await write("\x1b");
    await close();
    testClock.advanceTimersByTime(50);
    await terminal.flush();
    expect(events).toHaveLength(5);
  }));
