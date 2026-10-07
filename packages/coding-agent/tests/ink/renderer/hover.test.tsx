import { expect, test } from "bun:test";
import { useState, type ReactNode } from "react";
import {
  Box,
  Text,
  TextInput,
  AlternateScreen,
  renderSync,
  useInput,
  type BoxProps,
} from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

function MouseScreen({ children }: { children: ReactNode }) {
  useInput(() => {});
  return <AlternateScreen>{children}</AlternateScreen>;
}

test("wheel targets the topmost painted overlay and its nearest wheel handler", async () => {
  const terminal = createTerminal(20, 8);
  const events: string[] = [];
  const wheel = (name: string) => (event: Parameters<NonNullable<BoxProps["onWheel"]>>[0]) => {
    event.stopImmediatePropagation();
    events.push(`${name} ${Math.sign(event.deltaY)}`);
  };
  const app = renderSync(
    <MouseScreen>
      <Box height={8} flexDirection="column" onWheel={wheel("body")}>
        <Text>transcript</Text>
        <Box
          position="absolute"
          top={2}
          width={20}
          height={3}
          flexDirection="column"
          onWheel={wheel("menu")}
        >
          <Text>menu title</Text>
          <Box height={1} onClick={() => {}}>
            <Text>menu row</Text>
          </Box>
          <Text>menu footer</Text>
        </Box>
      </Box>
    </MouseScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[<65;4;4M\x1b[<64;4;3M\x1b[<65;4;1M\x1b[<65;30;4M");
    await terminal.flush();
    expect(events).toEqual(["menu 1", "menu -1", "body 1"]);
    app.unmount();
    terminal.stdin.write("\x1b[<65;4;4M");
    await terminal.flush();
    expect(events).toHaveLength(3);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("a primary press and release on the same painted button clicks once without editing input", async () => {
  const terminal = createTerminal();
  const clicks: string[] = [];
  const changes: string[] = [];
  const app = renderSync(
    <MouseScreen>
      <Box flexDirection="column">
        <Box
          width={8}
          height={1}
          marginLeft={2}
          onClick={(event) => {
            if (
              event.pressRow === 0 &&
              event.pressCol !== undefined &&
              event.pressCol >= 2 &&
              event.pressCol < 10 &&
              event.row === 0 &&
              event.col >= 2 &&
              event.col < 10
            )
              clicks.push("button");
          }}
        >
          <Text>回到底部</Text>
        </Box>
        <TextInput value="draft" onChange={(value) => changes.push(value)} />
      </Box>
    </MouseScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[<0;5;1M");
    await terminal.flush();
    expect(clicks).toEqual([]);
    terminal.stdin.write("\x1b[<0;5;1m");
    await terminal.flush();
    expect(clicks).toEqual(["button"]);
    terminal.stdin.write("\x1b[<0;5;1m\x1b[<2;5;1M\x1b[<2;5;1m");
    await terminal.flush();
    terminal.stdin.write("\x1b[<0;5;1M\x1b[<0;15;1m");
    await terminal.flush();
    terminal.stdin.write("\x1b[<0;15;1M\x1b[<0;5;1m");
    await terminal.flush();
    expect(clicks).toEqual(["button"]);
    expect(changes).toEqual([]);
    expect(terminal.screen()[1]).toBe("draft");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("nested hover follows the painted cells, leaves before entering siblings, and skips the same cell", async () => {
  const terminal = createTerminal();
  const events: string[] = [];
  const callbacks = (name: string) => ({
    onMouseEnter: () => events.push(`${name} enter`),
    onMouseLeave: () => events.push(`${name} leave`),
  });
  const app = renderSync(
    <MouseScreen>
      <Box width={10} height={3} marginLeft={2} borderStyle="single" {...callbacks("parent")}>
        <Box width={4} {...callbacks("left")}>
          <Text>left</Text>
        </Box>
        <Box width={4} {...callbacks("right")}>
          <Text>next</Text>
        </Box>
      </Box>
    </MouseScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[1]).toBe("  │leftnext│");
    terminal.stdin.write("\x1b[<35;4;2M");
    await terminal.flush();
    expect(events).toEqual(["left enter", "parent enter"]);
    terminal.stdin.write("\x1b[<35;4;2M\x1b[<35;5;2M");
    await terminal.flush();
    expect(events).toEqual(["left enter", "parent enter"]);
    terminal.stdin.write("\x1b[<35;8;2M");
    await terminal.flush();
    expect(events).toEqual(["left enter", "parent enter", "left leave", "right enter"]);
    terminal.stdin.write("\x1b[<35;20;8M");
    await terminal.flush();
    expect(events).toEqual([
      "left enter",
      "parent enter",
      "left leave",
      "right enter",
      "parent leave",
      "right leave",
    ]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("resize clears hover and the same cell can enter again after the new frame", async () => {
  const terminal = createTerminal();
  const events: string[] = [];
  const app = renderSync(
    <MouseScreen>
      <Box
        width={4}
        height={1}
        onMouseEnter={() => events.push("enter")}
        onMouseLeave={() => events.push("leave")}
      >
        <Text>item</Text>
      </Box>
    </MouseScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[<35;1;1M");
    await terminal.flush();
    expect(events).toEqual(["enter"]);
    const before = terminal.bytesWritten();
    terminal.resize(12, 6);
    expect(events).toEqual(["enter", "leave"]);
    await terminal.waitFor(() => terminal.bytesWritten() > before);
    terminal.stdin.write("\x1b[<35;1;1M");
    await terminal.flush();
    expect(events).toEqual(["enter", "leave", "enter"]);
    app.unmount();
    terminal.stdin.write("\x1b[<35;12;6M");
    await terminal.flush();
    expect(events).toEqual(["enter", "leave", "enter"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
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
  const app = renderSync(
    <MouseScreen>
      <View />
    </MouseScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[<35;1;1M");
    await terminal.flush();
    await terminal.waitFor(() => terminal.screen()[0] === "hovered");
    terminal.stdin.write("\x1b[<35;20;8M");
    await terminal.flush();
    await terminal.waitFor(() => terminal.screen()[0] === "ready");
    expect(terminal.screen()[1]).toBe("draft");
    expect(changes).toEqual([]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
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
  const app = renderSync(
    <MouseScreen>
      <View />
    </MouseScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[<35;1;1M\x1b[<35;2;1M");
    await terminal.flush();
    expect(events).toEqual(["child enter", "parent enter"]);
    await terminal.waitFor(() => terminal.screen()[0] === "new");
    terminal.stdin.write("\x1b[<35;3;1M");
    await terminal.flush();
    // Native detached nodes do not receive synthetic leave callbacks.
    expect(events).toEqual(["child enter", "parent enter"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
