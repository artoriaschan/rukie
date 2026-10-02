import { expect, test } from "bun:test";
import { useState } from "react";
import { Box, ScrollBox, Text, TextInput, render, type ScrollHandle } from "../../src";
import { createTerminal } from "../helpers/terminal";

test("nested hover follows the painted cells, leaves before entering siblings, and skips the same cell", async () => {
  const terminal = createTerminal();
  const events: string[] = [];
  const callbacks = (name: string) => ({
    onMouseEnter: () => events.push(`${name} enter`),
    onMouseLeave: () => events.push(`${name} leave`),
  });
  const app = render(
    <Box width={10} height={3} marginLeft={2} borderStyle="single" {...callbacks("parent")}>
      <Box width={4} {...callbacks("left")}>
        <Text>left</Text>
      </Box>
      <Box width={4} {...callbacks("right")}>
        <Text>next</Text>
      </Box>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[1]).toBe("  │leftnext│");
    terminal.stdin.write("\x1b[<35;4;2M");
    expect(events).toEqual(["left enter", "parent enter"]);
    terminal.stdin.write("\x1b[<35;4;2M\x1b[<35;5;2M");
    expect(events).toEqual(["left enter", "parent enter"]);
    terminal.stdin.write("\x1b[<35;8;2M");
    expect(events).toEqual(["left enter", "parent enter", "left leave", "right enter"]);
    terminal.stdin.write("\x1b[<35;20;8M");
    expect(events).toEqual([
      "left enter",
      "parent enter",
      "left leave",
      "right enter",
      "right leave",
      "parent leave",
    ]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("resize clears hover and the same cell can enter again after the new frame", async () => {
  const terminal = createTerminal();
  const events: string[] = [];
  const app = render(
    <Box
      width={4}
      height={1}
      onMouseEnter={() => events.push("enter")}
      onMouseLeave={() => events.push("leave")}
    >
      <Text>item</Text>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[<35;1;1M");
    expect(events).toEqual(["enter"]);
    const before = terminal.bytesWritten();
    terminal.resize(12, 6);
    expect(events).toEqual(["enter", "leave"]);
    await terminal.waitFor(() => terminal.bytesWritten() > before);
    terminal.stdin.write("\x1b[<35;1;1M");
    expect(events).toEqual(["enter", "leave", "enter"]);
    app.unmount();
    terminal.stdin.write("\x1b[<35;12;6M");
    expect(events).toEqual(["enter", "leave", "enter"]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("scrolling records new screen rectangles and excludes content clipped behind the dock", async () => {
  const terminal = createTerminal(20, 6);
  const scroll = { current: null as ScrollHandle | null };
  const events: string[] = [];
  const app = render(
    <Box height={6} flexDirection="column">
      <ScrollBox ref={scroll}>
        {Array.from({ length: 6 }, (_, index) => (
          <Box
            key={index}
            height={1}
            onMouseEnter={() => events.push(`${index} enter`)}
            onMouseLeave={() => events.push(`${index} leave`)}
          >
            <Text>row {index}</Text>
          </Box>
        ))}
      </ScrollBox>
      <Box height={2} onMouseEnter={() => events.push("dock enter")}>
        <Text>dock</Text>
      </Box>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["row 2", "row 3", "row 4", "row 5", "dock", ""]);
    terminal.stdin.write("\x1b[<35;1;1M");
    expect(events).toEqual(["2 enter"]);
    scroll.current!.scrollBy(-2);
    await terminal.waitFor(() => terminal.screen()[0] === "row 0");
    terminal.stdin.write("\x1b[<35;1;2M\x1b[<35;1;5M");
    expect(events).toEqual(["2 enter", "2 leave", "1 enter", "1 leave", "dock enter"]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("hover callbacks update React content without mouse motion editing TextInput", async () => {
  const terminal = createTerminal();
  const changes: string[] = [];
  function View() {
    const [hovered, setHovered] = useState(false);
    return (
      <Box flexDirection="column">
        <Box
          width={8}
          height={1}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <Text>{hovered ? "hovered" : "ready"}</Text>
        </Box>
        <TextInput value="draft" onChange={(value) => changes.push(value)} />
      </Box>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    terminal.stdin.write("\x1b[<35;1;1M");
    await terminal.waitFor(() => terminal.screen()[0] === "hovered");
    terminal.stdin.write("\x1b[<35;20;8M");
    await terminal.waitFor(() => terminal.screen()[0] === "ready");
    expect(terminal.screen()[1]).toBe("draft");
    expect(changes).toEqual([]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("hover uses painted ancestors when an enter callback removes a child before the next frame", async () => {
  const terminal = createTerminal();
  const events: string[] = [];
  function View() {
    const [show, setShow] = useState(true);
    return (
      <Box
        width={8}
        height={1}
        onMouseEnter={() => events.push("parent enter")}
        onMouseLeave={() => events.push("parent leave")}
      >
        {show ? (
          <Box
            key="child"
            width={8}
            height={1}
            onMouseEnter={() => {
              events.push("child enter");
              setShow(false);
            }}
            onMouseLeave={() => events.push("child leave")}
          >
            <Text>old</Text>
          </Box>
        ) : (
          <Text>new</Text>
        )}
      </Box>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    await terminal.flush();
    const before = terminal.bytesWritten();
    terminal.stdin.write("\x1b[<35;1;1M\x1b[<35;2;1M");
    expect(terminal.bytesWritten()).toBe(before);
    expect(events).toEqual(["child enter", "parent enter"]);
    await terminal.waitFor(() => terminal.screen()[0] === "new");
    terminal.stdin.write("\x1b[<35;3;1M");
    expect(events).toEqual(["child enter", "parent enter", "child leave"]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});
