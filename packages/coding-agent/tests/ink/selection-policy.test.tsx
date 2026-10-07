import { expect, test } from "bun:test";
import { useLayoutEffect } from "react";
import { AlternateScreen, Box, Text, renderSync, useInput, useSelection } from "../../src/ink";
import { createTerminal } from "./helpers/terminal";

test.each([1, 2, 3])(
  "root-local exclusion policy preserves Unicode selection for %i-click drags",
  async (clicks) => {
    const terminals = [createTerminal(24, 6), createTerminal(24, 6)];
    const controls: ReturnType<typeof useSelection>[] = [];
    function Screen({ index }: { index: number }) {
      useInput(() => {});
      const selection = useSelection();
      controls[index] = selection;
      useLayoutEffect(() => selection.setSelectionBgColor("#112233"), [selection]);
      return (
        <AlternateScreen>
          <Box>
            <Box width={2} noSelect flexShrink={0}>
              <Text>⏺</Text>
            </Box>
            <Box flexDirection="column">
              <Text>Alpha 中文🐋</Text>
              <Text>second value</Text>
            </Box>
          </Box>
        </AlternateScreen>
      );
    }
    const roots = [
      renderSync(<Screen index={0} />, terminals[0]!),
      renderSync(<Screen index={1} />, { ...terminals[1]!, selectionIncludeNoSelectCells: false }),
    ];
    const press = "\x1b[<0;1;1M";
    const release = "\x1b[<0;1;1m";
    try {
      await Promise.all(terminals.map((terminal) => terminal.flush()));
      for (const terminal of terminals) {
        terminal.stdin.write((press + release).repeat(clicks - 1) + press + "\x1b[<32;14;2M");
        await terminal.flush();
      }
      await terminals[1]!.waitFor(
        () => controls[1]!.getState()?.coveredText === "Alpha 中文🐋\nsecond value",
      );
      expect(controls[0]!.getState()).not.toBe(controls[1]!.getState());
      expect(controls[0]!.getState()?.includeNoSelectCells).toBe(true);
      expect(controls[0]!.getState()?.fence).toEqual({ colStart: 0, colEnd: 1 });
      expect(controls[1]!.getState()?.includeNoSelectCells).toBe(false);
      expect(controls[1]!.getState()?.fence).toBeUndefined();
      const first = terminals[0]!.terminal.buffer.active.getLine(0)!;
      const second = terminals[1]!.terminal.buffer.active.getLine(0)!;
      expect(first.getCell(0)!.isBgDefault()).toBe(false);
      expect(first.getCell(2)!.isBgDefault()).toBe(true);
      expect(second.getCell(0)!.isBgDefault()).toBe(true);
      expect(second.getCell(2)!.getBgColor()).toBe(0x112233);
      controls[0]!.clearSelection();
      await terminals[0]!.flush();
      expect(controls[1]!.hasSelection()).toBe(true);
      roots[0]!.unmount();
      await roots[0]!.waitUntilExit();
      roots[0]!.cleanup();
      expect(terminals[1]!.stdin.isRaw).toBe(true);
      expect(controls[1]!.getState()?.coveredText).toBe("Alpha 中文🐋\nsecond value");
    } finally {
      for (let index = 0; index < roots.length; index++) {
        roots[index]!.unmount();
        await roots[index]!.waitUntilExit();
        roots[index]!.cleanup();
        terminals[index]!.dispose();
      }
    }
  },
);
