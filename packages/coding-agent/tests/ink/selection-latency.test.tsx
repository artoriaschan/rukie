import {
  AlternateScreen,
  ScrollBox,
  Text,
  renderSync,
  useInput,
  useSelection,
} from "../../src/ink";
import { createTerminal } from "./helpers/terminal";

import { expect, test } from "bun:test";

test.each([40, 2000])(
  "drag bursts paint the latest selection once over %i source rows",
  async (lines) => {
    const terminal = createTerminal(120, 40);
    let selection!: ReturnType<typeof useSelection>;
    function Fixture() {
      useInput(() => {});
      selection = useSelection();
      return (
        <AlternateScreen>
          <ScrollBox height={40} stickyScroll={false}>
            <Text>
              {Array.from({ length: lines }, (_, i) => `row-${i} ` + "abcdefghij".repeat(10)).join(
                "\n",
              )}
            </Text>
          </ScrollBox>
        </AlternateScreen>
      );
    }
    const app = renderSync(<Fixture />, terminal);
    try {
      await terminal.waitFor(() => terminal.screen()[0]?.startsWith("row-0") === true);
      terminal.stdin.write("\x1b[<0;1;1M");
      await terminal.flush();
      const before = terminal.writes.length;
      terminal.stdin.write(Array.from({ length: 8 }, (_, i) => `\x1b[<32;110;${i + 20}M`).join(""));
      await terminal.waitFor(() => selection.getState()?.focus?.row === 26);
      expect(terminal.writes.length - before).toBe(1);
      const end = terminal.terminal.buffer.active.getLine(26)!;
      expect(end.getCell(109)!.isInverse()).toBeTruthy();
      expect(end.getCell(110)!.isInverse()).toBeFalsy();
      expect(terminal.terminal.buffer.active.getLine(27)!.getCell(0)!.isInverse()).toBeFalsy();
      terminal.stdin.write("\x1b[<0;110;27m");
      await terminal.waitFor(() => selection.getState()?.isDragging === false);
      expect(selection.readSelectionText()).toContain("row-26");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  },
);

test("drag coalescing keeps release and the next gesture distinct in one input batch", async () => {
  const terminal = createTerminal(120, 40);
  const copied: string[] = [];
  let selection!: ReturnType<typeof useSelection>;
  function Fixture() {
    useInput(() => {});
    selection = useSelection();
    return (
      <AlternateScreen>
        <Text>{Array.from({ length: 8 }, (_, index) => `row-${index} abcdefghij`).join("\n")}</Text>
      </AlternateScreen>
    );
  }
  const app = renderSync(<Fixture />, terminal);
  let unsubscribe = () => {};
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "row-0 abcdefghij");
    unsubscribe = selection.subscribe(() => {
      const state = selection.getState();
      if (!state?.anchor || state.isDragging) return;
      copied.push(selection.readSelectionText());
      selection.clearSelection();
    });
    terminal.stdin.write(
      "\x1b[<0;1;1M\x1b[<32;3;1M\x1b[<32;8;1M\x1b[<0;8;1m" +
        "\x1b[<0;1;4M\x1b[<32;3;4M\x1b[<32;8;4M\x1b[<0;8;4m",
    );
    await terminal.waitFor(() => copied.length === 2);
    expect(copied).toEqual(["row-0 ab", "row-3 ab"]);
    expect(terminal.terminal.buffer.active.getLine(3)!.getCell(0)!.isInverse()).toBeFalsy();
  } finally {
    unsubscribe();
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
