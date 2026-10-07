import { expect, test } from "bun:test";
import FakeTimers from "@sinonjs/fake-timers";
import { createRef, useState, useLayoutEffect } from "react";
import {
  AlternateScreen,
  Box,
  ScrollBox,
  Text,
  renderSync,
  useInput,
  useSelection,
  type ScrollBoxHandle,
} from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

const rows = (count: number) => Array.from({ length: count }, (_, i) => `row-${i}`).join("\n");
// The oracle reads the root's public selection state/text. It never writes a clipboard.
async function mountRows({
  text = rows(10),
  columns = 20,
  top = 0,
  following = false,
  singleRowWheel = false,
  gutter = false,
  remount = false,
} = {}) {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const terminal = createTerminal(columns, 6, (ms) => clock.tick(ms));
  const scroll = createRef<ScrollBoxHandle>();
  let selection!: ReturnType<typeof useSelection>;
  let replace = (_text: string) => {};
  function Screen() {
    useInput(() => {});
    selection = useSelection();
    useLayoutEffect(() => {
      selection.setSelectionBgColor("#345678");
    }, [selection]);
    const [value, setValue] = useState(text);
    replace = setValue;
    return (
      <AlternateScreen>
        <Box height={6} flexDirection="column">
          <Text>{value === text ? "header" : "changed"}</Text>
          <ScrollBox height={4} ref={scroll} stickyScroll={following}>
            <Box
              flexShrink={0}
              onWheel={
                singleRowWheel
                  ? (event) => {
                      scroll.current?.scrollBy(Math.sign(event.deltaY));
                      event.stopImmediatePropagation();
                    }
                  : undefined
              }
            >
              <Text key={remount ? value : "stable"}>{value}</Text>
              {gutter && (
                <Box position="absolute" top={0} left={0} width={1} height={1} noSelect>
                  <Text>│</Text>
                </Box>
              )}
            </Box>
          </ScrollBox>
          <Text>footer</Text>
        </Box>
      </AlternateScreen>
    );
  }
  const app = renderSync(<Screen />, { ...terminal, selectionIncludeNoSelectCells: false });
  await terminal.flush();
  if (top) {
    scroll.current!.scrollTo(top);
    await terminal.waitFor(
      () => scroll.current!.getScrollTop() === top && terminal.screen()[1] === `row-${top}`,
    );
  }
  return {
    terminal,
    scroll,
    selection: () => selection,
    replace: (value: string) => replace(value),
    async dispose() {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
      clock.uninstall();
    },
  };
}
async function release(fixture: Awaited<ReturnType<typeof mountRows>>, x = 5, y = 5) {
  fixture.terminal.stdin.write(`\x1b[<0;${x};${y}m`);
  await fixture.terminal.waitFor(() => fixture.selection().getState()?.isDragging === false);
}
for (const kind of [
  "ansi",
  "outside-prefix",
  "outside-wide-prefix",
  "remount",
  "blank",
  "outside-suffix",
] as const) {
  test(`captured source validation distinguishes ${kind} from selected byte changes`, async () => {
    const initial = kind === "blank" ? rows(10).replace("row-2", "") : rows(10);
    const f = await mountRows({ text: initial, remount: kind === "remount" });
    try {
      const x = kind === "outside-prefix" || kind === "outside-wide-prefix" ? 3 : 1;
      f.terminal.stdin.write(`\x1b[<0;${x};4M\x1b[<32;5;5M`);
      await f.terminal.waitFor(
        () =>
          !f.terminal.terminal.buffer.active
            .getLine(3)!
            .getCell(x - 1)!
            .isBgDefault(),
      );
      f.terminal.stdin.write("\x1b[<65;5;5M");
      await f.terminal.waitFor(() => f.terminal.screen()[1] === "row-3");
      const replacement =
        kind === "ansi"
          ? `\x1b[31m${initial}\x1b[0m`
          : kind === "outside-prefix"
            ? initial.replace("row-2", "xxw-2")
            : kind === "outside-wide-prefix"
              ? initial.replace("row-2", "界w-2")
              : kind === "remount"
                ? initial.replace("row-9", "OTHER")
                : kind === "blank"
                  ? initial.replace("row-1\n\n", "row-1\nOTHER\n")
                  : initial.replace("row-2", "row-2-more");
      f.replace(replacement);
      await f.terminal.waitFor(() => f.terminal.screen()[0] === "changed");
      await release(f);
      const stale = kind === "blank";
      expect(f.selection().getState()?.stale).toBe(stale);
      expect(f.selection().readSelectionText()).toBe(
        stale
          ? ""
          : kind === "outside-prefix" || kind === "outside-wide-prefix"
            ? "w-2\nrow-3"
            : "row-2\nrow-3",
      );
    } finally {
      await f.dispose();
    }
  });
}

test.each(["a", "é"])(
  "captured decomposed grapheme validates displayed source against %s",
  async (replacement) => {
    const initial = rows(10).replace("row-2", "e\u0301ow-2");
    const f = await mountRows({ text: initial });
    try {
      f.terminal.stdin.write("\x1b[<0;1;4M\x1b[<32;5;5M");
      await f.terminal.waitFor(
        () => !f.terminal.terminal.buffer.active.getLine(3)!.getCell(0)!.isBgDefault(),
      );
      f.terminal.stdin.write("\x1b[<65;5;5M");
      await f.terminal.waitFor(() => f.terminal.screen()[1] === "row-3");
      f.replace(initial.replace("e\u0301ow-2", `${replacement}ow-2`));
      await f.terminal.waitFor(() => f.terminal.screen()[0] === "changed");
      await release(f);
      expect(f.selection().getState()?.stale).toBe(replacement === "a");
      expect(f.selection().readSelectionText()).toBe(
        replacement === "a" ? "" : "e\u0301ow-2\nrow-3",
      );
    } finally {
      await f.dispose();
    }
  },
);
