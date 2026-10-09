import {
  AlternateScreen,
  Box,
  ScrollBox,
  Text,
  renderSync,
  useInput,
  useSelection,
  type DOMElement,
  type ScrollBoxHandle,
} from "../../src/ink";
import { createTerminal } from "./helpers/terminal";

import FakeTimers from "@sinonjs/fake-timers";
import { createRef, useState } from "react";

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

test("separate drag motions over a fragmented transcript avoid per-glyph tree walks", async () => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const terminal = createTerminal(160, 50, (ms) => clock.tick(ms));
  const transcript = createRef<DOMElement>();
  const scroll = createRef<ScrollBoxHandle>();
  let replaceFirst = (_value: string) => {};
  let restoreRows = () => {};
  let selection!: ReturnType<typeof useSelection>;
  function Fixture() {
    useInput(() => {});
    const [first, setFirst] = useState("row-0 ");
    replaceFirst = setFirst;
    selection = useSelection();
    return (
      <AlternateScreen>
        <ScrollBox ref={scroll} height={50} stickyScroll={false}>
          <Box ref={transcript} flexDirection="column" flexShrink={0}>
            {Array.from({ length: 2000 }, (_, i) => (
              <Text key={i}>{(i === 0 ? first : `row-${i} `) + "abcdefghij".repeat(14)}</Text>
            ))}
          </Box>
        </ScrollBox>
      </AlternateScreen>
    );
  }
  const app = renderSync(<Fixture />, terminal);
  try {
    await terminal.waitFor(() => terminal.screen()[0]?.startsWith("row-0") === true);
    terminal.stdin.write("\x1b[<0;1;1M");
    await terminal.flush();
    if (!transcript.current) throw new Error("Transcript did not mount");
    const owner = transcript.current;
    const children = owner.childNodes;
    let reads = 0;
    // Count mounted-row visits at the public Box ref. This pins the cost
    // without a machine-dependent wall-clock threshold or mocked renderer.
    Object.defineProperty(owner, "childNodes", {
      configurable: true,
      get() {
        reads++;
        return children;
      },
    });
    restoreRows = () =>
      Object.defineProperty(owner, "childNodes", {
        configurable: true,
        writable: true,
        value: children,
      });
    for (let i = 0; i < 8; i++) {
      reads = 0;
      terminal.stdin.write(`\x1b[<32;140;${35 + i}M`);
      await terminal.waitFor(() => selection.getState()?.focus?.row === 34 + i);
      expect(reads).toBeLessThan(20000);
    }
    expect(terminal.terminal.buffer.active.getLine(41)!.getCell(139)!.isInverse()).toBeTruthy();
    expect(terminal.terminal.buffer.active.getLine(41)!.getCell(140)!.isInverse()).toBeFalsy();
    expect(selection.readSelectionText()).toContain("row-41");
    terminal.stdin.write("\x1b[<65;140;42M");
    await terminal.waitFor(() => terminal.screen()[0]?.startsWith("row-3 ") === true);
    expect(selection.readSelectionText()).toContain("row-0");
    replaceFirst("changed-0 ");
    await terminal.waitFor(() => selection.getState()?.stale === true);
    terminal.stdin.write("\x1b[<0;140;42m");
    await terminal.waitFor(() => selection.getState()?.isDragging === false);
    expect(selection.readSelectionText()).toBe("");
  } finally {
    restoreRows();
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
    clock.uninstall();
  }
});
