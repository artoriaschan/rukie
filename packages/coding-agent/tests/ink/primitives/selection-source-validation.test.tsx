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
for (const [name, anchorRow, expected, wheel, moveAfterWheel] of [
  ["within viewport", 4, "row-3", true, false],
  ["one selected outgoing row", 3, "row-2\nrow-3", true, false],
  ["new pointer movement extends", 3, "row-2\nrow-3\nrow-4\nrow-5\nrow-6", true, true],
  ["control without wheel", 3, "row-2\nrow-3", false, false],
] as const)
  test(`held drag survives wheel down with ${name} and retains original painted text`, async () => {
    const f = await mountRows();
    const { terminal } = f;
    try {
      expect(terminal.screen()).toEqual(["header", "row-0", "row-1", "row-2", "row-3", "footer"]);
      terminal.stdin.write(`\x1b[<0;1;${anchorRow + 1}M\x1b[<32;5;5M`);
      await terminal.waitFor(
        () => !terminal.terminal.buffer.active.getLine(anchorRow)!.getCell(0)!.isBgDefault(),
      );
      if (wheel) {
        terminal.stdin.write("\x1b[<65;5;5M");
        await terminal.waitFor(() => terminal.screen()[1] === "row-3");
        expect(terminal.screen()).toEqual(["header", "row-3", "row-4", "row-5", "row-6", "footer"]);
      }
      if (moveAfterWheel) terminal.stdin.write("\x1b[<32;5;5M");
      await release(f);
      expect(f.selection().readSelectionText()).toBe(expected);
    } finally {
      await f.dispose();
    }
  });
for (const selectedChanges of [true, false])
  test(
    selectedChanges
      ? "changing captured source refuses extraction"
      : "updating outside captured source keeps extraction safe",
    async () => {
      const f = await mountRows();
      const { terminal } = f;
      try {
        terminal.stdin.write("\x1b[<0;1;4M\x1b[<32;5;5M");
        await terminal.waitFor(
          () => !terminal.terminal.buffer.active.getLine(3)!.getCell(0)!.isBgDefault(),
        );
        terminal.stdin.write("\x1b[<65;5;5M");
        await terminal.waitFor(() => terminal.screen()[1] === "row-3");
        f.replace(
          Array.from({ length: 10 }, (_, i) =>
            i === (selectedChanges ? 2 : 9) ? "OTHER" : `row-${i}`,
          ).join("\n"),
        );
        await terminal.waitFor(() => terminal.screen()[0] === "changed");
        await release(f);
        expect(f.selection().readSelectionText()).toBe(selectedChanges ? "" : "row-2\nrow-3");
        expect(f.selection().getState()?.stale).toBe(selectedChanges);
      } finally {
        await f.dispose();
      }
    },
  );
test("held drag scrolls down twice and back without duplicating captured rows", async () => {
  const f = await mountRows({ text: rows(12) });
  const { terminal } = f;
  try {
    terminal.stdin.write("\x1b[<0;1;4M\x1b[<32;5;5M\x1b[<65;5;5M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-3");
    terminal.stdin.write("\x1b[<65;5;5M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-6");
    terminal.stdin.write("\x1b[<64;5;5M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-3");
    await release(f);
    expect(f.selection().readSelectionText()).toBe("row-2\nrow-3");
  } finally {
    await f.dispose();
  }
});
test("upward held drag captures selected outgoing bottom rows", async () => {
  const f = await mountRows({ top: 3 });
  const { terminal } = f;
  try {
    expect(terminal.screen()[1]).toBe("row-3");
    terminal.stdin.write("\x1b[<0;5;5M\x1b[<32;1;2M\x1b[<64;1;2M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-0");
    await release(f, 1, 3);
    expect(f.selection().readSelectionText()).toBe("row-3\nrow-4\nrow-5\nrow-6");
  } finally {
    await f.dispose();
  }
});
test("auto-follow preserves the held anchor and captures rows as a stream grows", async () => {
  const f = await mountRows({ text: rows(6), following: true });
  const { terminal } = f;
  try {
    expect(terminal.screen()[1]).toBe("row-2");
    terminal.stdin.write("\x1b[<0;1;3M\x1b[<32;5;5M");
    await terminal.waitFor(
      () => !terminal.terminal.buffer.active.getLine(2)!.getCell(0)!.isBgDefault(),
    );
    f.replace(rows(8));
    await terminal.waitFor(() => terminal.screen()[1] === "row-4");
    await release(f);
    expect(f.selection().readSelectionText()).toBe("row-3\nrow-4\nrow-5");
  } finally {
    await f.dispose();
  }
});
test("a held selection fully scrolled off the same edge is discarded only on release", async () => {
  const f = await mountRows({ text: rows(12) });
  const { terminal } = f;
  try {
    terminal.stdin.write("\x1b[<0;1;4M\x1b[<32;5;5M\x1b[<65;5;5M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-3");
    terminal.stdin.write("\x1b[<65;5;5M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-6");
    expect(f.selection().getState()?.isDragging).toBe(true);
    await release(f);
    expect(f.selection().readSelectionText()).toBe("");
    expect(terminal.terminal.buffer.active.getLine(1)!.getCell(0)!.isBgDefault()).toBe(true);
  } finally {
    await f.dispose();
  }
});
test("captured Unicode soft wraps retain whole glyphs and exclude decorated gutters", async () => {
  const f = await mountRows({
    columns: 10,
    text: "│中🐋hello worldabcdefgh\nB\nC\nD\nE",
    singleRowWheel: true,
    gutter: true,
  });
  const { terminal } = f;
  try {
    expect(terminal.screen()[1]).toBe("│中🐋hello");
    terminal.stdin.write("\x1b[<0;3;2M\x1b[<32;1;4M\x1b[<65;10;3M");
    await terminal.waitFor(() => terminal.screen()[1] === " worldabcd");
    await release(f, 1, 3);
    expect(f.selection().readSelectionText()).toBe("中🐋hello worldabcde");
  } finally {
    await f.dispose();
  }
});
test("captured wide glyph continuation remains subject to source validation", async () => {
  const f = await mountRows({ columns: 10, text: "中\nNEXT\nfoo\nbar\nz", singleRowWheel: true });
  const { terminal } = f;
  try {
    expect(terminal.screen()[1]).toBe("中");
    terminal.stdin.write("\x1b[<0;2;2M\x1b[<32;1;3M\x1b[<65;1;3M");
    await terminal.waitFor(() => terminal.screen()[1] === "NEXT");
    f.replace("另\nNEXT\nfoo\nbar\nz");
    await terminal.waitFor(() => terminal.screen()[0] === "changed");
    await release(f, 1, 3);
    expect(f.selection().readSelectionText()).toBe("");
    expect(f.selection().getState()?.stale).toBe(true);
  } finally {
    await f.dispose();
  }
});

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
