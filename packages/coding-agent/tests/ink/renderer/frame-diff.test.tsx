import { expect, test } from "bun:test";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { AlternateScreen, Box, Text, renderSync, useDeclaredCursor } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

function terminalState(io: ReturnType<typeof createTerminal>) {
  const { terminal } = io;
  const buffer = terminal.buffer.active;
  return {
    cells: Array.from({ length: terminal.rows }, (_, y) =>
      Array.from({ length: terminal.cols }, (_, x) => {
        const cell = buffer.getLine(buffer.viewportY + y)!.getCell(x)!;
        return {
          text: cell.getChars() || " ",
          width: cell.getWidth(),
          colorMode: cell.getFgColorMode(),
          color: cell.getFgColor(),
          backgroundMode: cell.getBgColorMode(),
          background: cell.getBgColor(),
          underline: cell.isUnderline(),
          bold: cell.isBold(),
          dim: cell.isDim(),
          inverse: cell.isInverse(),
          italic: cell.isItalic(),
          strikethrough: cell.isStrikethrough(),
          overline: cell.isOverline(),
          blink: cell.isBlink(),
          invisible: cell.isInvisible(),
        };
      }),
    ),
    cursor: io.cursor(),
    scrollback: buffer.baseY,
  };
}

test("changing one character preserves the complete viewport without scrollback", async () => {
  const terminal = createTerminal(80, 24);
  let update = (_text: string) => {};
  const initial = Array.from({ length: 24 }, () => "A".repeat(80)).join("\n");
  function View() {
    const [text, setText] = useState(initial);
    useLayoutEffect(() => {
      update = setText;
    }, []);
    return <Text>{text}</Text>;
  }
  const app = renderSync(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    update("B" + initial.slice(1));
    await terminal.waitFor(() => terminal.screen()[0]?.startsWith("B") === true);
    expect(terminal.screen()).toEqual(["B" + "A".repeat(79), ...Array(23).fill("A".repeat(80))]);
    expect(terminal.terminal.buffer.active.baseY).toBe(0);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("successive text, style and wide glyph changes match fresh full renders cell for cell", async () => {
  const terminal = createTerminal(8, 5);
  let update = (_frame: ReactNode) => {};
  const frames = [
    <Text>A</Text>,
    <Text>AB中文CDEF</Text>,
    <Text>AB</Text>,
    <Text color="ansi:red" bold>
      AB
    </Text>,
    <Text color="ansi:red" dim>
      AB
    </Text>,
    <Text underline>AB</Text>,
    <Text strikethrough>AB</Text>,
    <Text color="ansi:blue" backgroundColor="#234567">
      AB
    </Text>,
    <Text color="ansi:blue">AB</Text>,
    <Text color="#12ab34">AB</Text>,
    <Text inverse>AB</Text>,
    <Text italic>AB</Text>,
    <Text inverse italic>
      AB
    </Text>,
    <Text>AB</Text>,
    <Text>中文AB</Text>,
    <Text inverse italic>
      中文AB
    </Text>,
    <Text>中文AB</Text>,
    <Text>ABCDEF</Text>,
    <Text>A中DEF</Text>,
    <Text>AB中EF</Text>,
    <Text>中文中</Text>,
    <Text>中文</Text>,
    <Text>文</Text>,
    <Text>é👩‍💻AB</Text>,
    <Text>{"123456中\nABCDEFGH\n中文中文\nlast row\nbottom中"}</Text>,
    <Text>{"123456AB\nABCDEFGH\nABCDEFGH\nlast row\nbottomAB"}</Text>,
    <Text>{"123456中\nABCDEFGH\n中文中文\nlast row\nbottom中"}</Text>,
    <Box flexDirection="column" borderStyle="single" width={8}>
      <Text color="ansi:green" bold>
        中A
      </Text>
    </Box>,
    <Text>short</Text>,
    <Text>{"old\nrows\nremoved"}</Text>,
    <Text>{"old\n"}</Text>,
    <Text>old</Text>,
    <Text>{""}</Text>,
    null,
    <Text>new</Text>,
  ];
  function View() {
    const [frame, setFrame] = useState<ReactNode>(null);
    useLayoutEffect(() => {
      update = setFrame;
    }, []);
    return <CursorFrame>{frame}</CursorFrame>;
  }
  function CursorFrame({ children }: { children: ReactNode }) {
    const ref = useDeclaredCursor({ line: 0, column: 0, active: true });
    return (
      <Box ref={ref} height={5} flexShrink={0} flexDirection="column">
        {children}
      </Box>
    );
  }
  let painted = 0;
  const app = renderSync(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    {
      ...terminal,
      onFrame: () => painted++,
    },
  );
  try {
    await terminal.flush();
    for (const frame of frames) {
      const before = painted;
      update(frame);
      await terminal.waitFor(() => painted > before);
      const fresh = createTerminal(8, 5);
      const reference = renderSync(
        <AlternateScreen>
          <CursorFrame>{frame}</CursorFrame>
        </AlternateScreen>,
        fresh,
      );
      try {
        await fresh.flush();
        expect(terminalState(terminal)).toEqual(terminalState(fresh));
      } finally {
        reference.unmount();
        await reference.waitUntilExit();
        reference.cleanup();
        fresh.dispose();
      }
    }
    expect(terminal.screen()).toEqual(["new", "", "", "", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
