import { expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";
import { Box, Text, render } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

for (const style of ["inverse", "italic", "underline"] as const) {
  test(`Text repaints an unchanged character when ${style} is enabled or disabled`, async () => {
    const terminal = createTerminal(8, 2);
    let update = (_enabled: boolean) => {};
    function View() {
      const [enabled, setEnabled] = useState(false);
      useLayoutEffect(() => {
        update = setEnabled;
      }, []);
      return <Text {...{ [style]: enabled }}>A</Text>;
    }
    const cell = () => terminal.terminal.buffer.active.getLine(0)!.getCell(0)!;
    const enabled = () =>
      style === "inverse"
        ? cell().isInverse()
        : style === "italic"
          ? cell().isItalic()
          : cell().isUnderline();
    const app = render(<View />, terminal);
    try {
      await terminal.flush();
      expect(enabled()).toBeFalsy();
      update(true);
      await terminal.waitFor(() => !!enabled());
      expect(cell().getChars()).toBe("A");
      update(false);
      await terminal.waitFor(() => !enabled());
      expect(cell().getChars()).toBe("A");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  });
}

test("inverse, italic and underline survive nesting and wrapping without leaking to siblings", async () => {
  const terminal = createTerminal(8, 4);
  const app = render(
    <Box flexDirection="column" width={3}>
      <Text inverse italic underline>
        A
        <Text inverse={false} italic={false} underline={false}>
          B
        </Text>
        CD
      </Text>
      <Text>E</Text>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["ABC", "D", "E", ""]);
    const cell = (x: number, y: number) => terminal.terminal.buffer.active.getLine(y)!.getCell(x)!;
    for (const [x, y] of [
      [0, 0],
      [2, 0],
      [0, 1],
    ] as const) {
      expect(cell(x, y).isInverse()).toBeTruthy();
      expect(cell(x, y).isItalic()).toBeTruthy();
      expect(cell(x, y).isUnderline()).toBeTruthy();
    }
    for (const [x, y] of [
      [1, 0],
      [0, 2],
    ] as const) {
      expect(cell(x, y).isInverse()).toBeFalsy();
      expect(cell(x, y).isItalic()).toBeFalsy();
      expect(cell(x, y).isUnderline()).toBeFalsy();
    }
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

for (const value of ["1", "", undefined]) {
  for (const color of ["#12ab34", "red"] as const) {
    test(`NO_COLOR=${JSON.stringify(value)} respects ${color} in text and box backgrounds while retaining emphasis`, async () => {
      const previous = process.env.NO_COLOR;
      if (value === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = value;
      const terminal = createTerminal(8, 2);
      const app = render(
        <Box width={8} backgroundColor={color}>
          <Text color={color} bold dimColor inverse italic>
            A
          </Text>
        </Box>,
        terminal,
      );
      try {
        await terminal.flush();
        const cell = terminal.terminal.buffer.active.getLine(0)!.getCell(0)!;
        expect(cell.getChars()).toBe("A");
        expect(cell.isBold()).toBeTruthy();
        expect(cell.isDim()).toBeTruthy();
        expect(cell.isInverse()).toBeTruthy();
        expect(cell.isItalic()).toBeTruthy();
        if (value) {
          expect(cell.isFgDefault()).toBeTruthy();
          expect(cell.isBgDefault()).toBeTruthy();
          expect(terminal.terminal.buffer.active.getLine(0)!.getCell(7)!.isBgDefault()).toBe(true);
          // oxlint-disable-next-line no-control-regex -- inspect SGR bytes at the terminal IO seam
          const codes = [...terminal.output().matchAll(/\x1b\[([\d;]*)m/g)].flatMap((match) =>
            match[1]!.split(";"),
          );
          expect(codes).toEqual(expect.arrayContaining(["1", "2", "3", "7"]));
          expect(codes.every((code) => ["0", "1", "2", "3", "7"].includes(code))).toBe(true);
        } else {
          expect(cell.getFgColor()).toBe(color === "red" ? 1 : 0x12ab34);
          expect(cell.getBgColor()).toBe(color === "red" ? 1 : 0x12ab34);
          expect(terminal.terminal.buffer.active.getLine(0)!.getCell(7)!.getBgColor()).toBe(
            color === "red" ? 1 : 0x12ab34,
          );
        }
      } finally {
        app.unmount();
        await app.waitUntilExit();
        terminal.dispose();
        if (previous === undefined) delete process.env.NO_COLOR;
        else process.env.NO_COLOR = previous;
      }
    });
  }
}

test("round borders preserve box layout while drawing rounded corner glyphs", async () => {
  const terminal = createTerminal(6, 3);
  const app = render(
    <Box width={6} height={3} borderStyle="round">
      <Text>card</Text>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["╭────╮", "│card│", "╰────╯"]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});
