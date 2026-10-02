import { expect, test } from "bun:test";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { Box, Static, Text, TextInput, render } from "../../src";
import { createTerminal } from "../helpers/terminal";

test("Static appends each keyed item once above the active area, preserving shell output", async () => {
  const terminal = createTerminal(12, 4);
  terminal.stdout.write("shell\r\n");
  await terminal.flush();
  let update = (_version: number) => {};
  function View() {
    const [version, setVersion] = useState(0);
    useLayoutEffect(() => {
      update = setVersion;
    }, []);
    return (
      <Box flexDirection="column">
        <Static>
          {Array.from({ length: 6 + version }, (_, index) => (
            <Text key={index} color="green">{`item${index}`}</Text>
          ))}
        </Static>
        <Text>{`live${version}`}</Text>
      </Box>
    );
  }
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    expect(terminal.scrollback()).toEqual(["shell", "item0", "item1", "item2", "item3"]);
    expect(terminal.screen()).toEqual(["item4", "item5", "live0", ""]);
    update(2);
    await terminal.waitFor(() => terminal.screen().includes("live2"));
    expect(terminal.scrollback()).toEqual([
      "shell",
      "item0",
      "item1",
      "item2",
      "item3",
      "item4",
      "item5",
    ]);
    expect(terminal.screen()).toEqual(["item6", "item7", "live2", ""]);
    update(1);
    await terminal.waitFor(() => terminal.screen().includes("live1"));
    expect(terminal.scrollback()).toEqual([
      "shell",
      "item0",
      "item1",
      "item2",
      "item3",
      "item4",
      "item5",
    ]);
    expect(terminal.screen()).toEqual(["item6", "item7", "live1", ""]);
    const output = terminal.writes.map(({ text }) => text).join("");
    for (let index = 0; index < 8; index++) {
      expect(output.split(`item${index}`).length - 1).toBe(1);
    }
    const buffer = terminal.terminal.buffer.active;
    expect(buffer.getLine(buffer.baseY)!.getCell(0)!.getFgColor()).toBe(2);
    expect(
      buffer
        .getLine(buffer.baseY + 2)!
        .getCell(0)!
        .isFgDefault(),
    ).toBeTruthy();
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("inline history, input cursor and resize remain aligned while completed items append", async () => {
  const terminal = createTerminal(12, 5);
  let append = () => {};
  function View() {
    const [count, setCount] = useState(6);
    const [value, setValue] = useState("中文ABCDEF");
    useLayoutEffect(() => {
      append = () => setCount(7);
    }, []);
    return (
      <Box flexDirection="column">
        <Static>
          {Array.from({ length: count }, (_, index) => (
            <Text key={index}>{`done${index}`}</Text>
          ))}
        </Static>
        <TextInput value={value} onChange={setValue} />
      </Box>
    );
  }
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["done3", "done4", "done5", "中文ABCDEF", ""]);
    expect(terminal.cursor()).toEqual({ x: 10, y: 3 });
    terminal.resize(8, 5);
    await terminal.waitFor(() => terminal.screen()[3] === "EF");
    expect(terminal.screen()).toEqual(["done4", "done5", "中文ABCD", "EF", ""]);
    expect(terminal.cursor()).toEqual({ x: 2, y: 3 });
    terminal.stdin.write("\x1b[D");
    await terminal.waitFor(() => terminal.cursor().x === 1);
    append();
    await terminal.waitFor(() => terminal.screen()[1] === "done6");
    expect(terminal.cursor()).toEqual({ x: 1, y: 3 });
    terminal.stdin.write("Z");
    await terminal.waitFor(() => terminal.screen()[3] === "EZF");
    expect(terminal.cursor()).toEqual({ x: 2, y: 3 });
    terminal.resize(12, 7);
    await terminal.waitFor(() => terminal.screen().includes("中文ABCDEZF"));
    expect(terminal.screen()).toEqual(["done5", "done6", "中文ABCDEZF", "", "", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 10, y: 2 });
    expect(terminal.scrollback()).toEqual(["done0", "done1", "done2", "done3", "done4"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("Static includes item margins when measuring completed content", async () => {
  const terminal = createTerminal(10, 5);
  const app = render(
    <>
      <Static>
        <Box key="item" marginTop={1} marginLeft={2} marginBottom={1}>
          <Text>DONE</Text>
        </Box>
      </Static>
      <Text>active</Text>
    </>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["", "  DONE", "", "active", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("Static preserves box dimensions, borders and wide text when writing completed content", async () => {
  const terminal = createTerminal(10, 4);
  const app = render(
    <>
      <Static>
        <Box key="result" width={6} padding={1} borderStyle="single">
          <Text color="red">中</Text>
        </Box>
      </Static>
      <Text>live</Text>
    </>,
    terminal,
  );
  try {
    await terminal.flush();
    expect([...terminal.scrollback(), ...terminal.screen()]).toEqual([
      "┌────┐",
      "│    │",
      "│ 中 │",
      "│    │",
      "└────┘",
      "live",
      "",
    ]);
    expect(terminal.terminal.buffer.active.getLine(2)!.getCell(2)!.getFgColor()).toBe(1);
    expect(terminal.terminal.buffer.active.getLine(2)!.getCell(2)!.getWidth()).toBe(2);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("a tall active area stays at the bottom without pushing old active frames into scrollback", async () => {
  const terminal = createTerminal(8, 3);
  let update = (_frame: ReactNode) => {};
  function View() {
    const [frame, setFrame] = useState<ReactNode>(<Text>{"old1\nold2\nold3\nold4"}</Text>);
    useLayoutEffect(() => {
      update = setFrame;
    }, []);
    return (
      <Box flexDirection="column">
        <Static>
          <Text key="done">completed</Text>
        </Static>
        {frame}
      </Box>
    );
  }
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    expect(terminal.scrollback()).toEqual(["complete", "d"]);
    expect(terminal.screen()).toEqual(["old2", "old3", "old4"]);
    update(<Text>{"new1\nnew2\nnew3\nnew4\nnew5"}</Text>);
    await terminal.waitFor(() => terminal.screen()[2] === "new5");
    expect(terminal.screen()).toEqual(["new3", "new4", "new5"]);
    expect(terminal.scrollback()).toEqual(["complete", "d"]);
    update(<Text>short</Text>);
    await terminal.waitFor(() => terminal.screen()[0] === "short");
    expect(terminal.screen()).toEqual(["short", "", ""]);
    expect(terminal.scrollback()).toEqual(["complete", "d"]);
    update(<Text>{"grow1\ngrow2\ngrow3\ngrow4"}</Text>);
    await terminal.waitFor(() => terminal.screen()[2] === "grow4");
    expect(terminal.screen()).toEqual(["grow2", "grow3", "grow4"]);
    expect(terminal.scrollback()).toEqual(["complete", "d"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
