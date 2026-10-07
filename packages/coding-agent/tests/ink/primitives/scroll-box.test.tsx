import { expect, test } from "bun:test";
import FakeTimers from "@sinonjs/fake-timers";
import { createRef, useState } from "react";
import {
  AlternateScreen,
  Box,
  ScrollBox,
  Text,
  renderSync,
  type ScrollBoxHandle,
} from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test.each([true, false])(
  "stickyScroll=%s controls initial growth and explicit bottom reading resumes following",
  async (stickyScroll) => {
    const terminal = createTerminal(20, 4);
    const scroll = createRef<ScrollBoxHandle>();
    let update = (_count: number) => {};
    function View() {
      const [count, setCount] = useState(10);
      update = setCount;
      return (
        <Box flexDirection="column" height={4}>
          <Text>header</Text>
          <ScrollBox ref={scroll} height={2} stickyScroll={stickyScroll}>
            <Box flexShrink={0}>
              <Text>{Array.from({ length: count }, (_, index) => `line ${index}`).join("\n")}</Text>
            </Box>
          </ScrollBox>
          <Text>footer</Text>
        </Box>
      );
    }
    const app = renderSync(
      <AlternateScreen>
        <View />
      </AlternateScreen>,
      terminal,
    );
    try {
      await terminal.flush();
      expect(terminal.screen()).toEqual(
        stickyScroll
          ? ["header", "line 8", "line 9", "footer"]
          : ["header", "line 0", "line 1", "footer"],
      );
      update(11);
      await terminal.waitFor(() => scroll.current!.getScrollHeight() === 11);
      expect(terminal.screen()).toEqual(
        stickyScroll
          ? ["header", "line 9", "line 10", "footer"]
          : ["header", "line 0", "line 1", "footer"],
      );
      scroll.current!.scrollToBottom();
      await terminal.waitFor(() => terminal.screen()[2] === "line 10");
      update(12);
      await terminal.waitFor(() => scroll.current!.getScrollHeight() === 12);
      expect(terminal.screen()).toEqual(["header", "line 10", "line 11", "footer"]);
      expect(scroll.current!.isSticky()).toBe(true);
      update(1);
      await terminal.waitFor(() => terminal.screen()[1] === "line 0");
      expect(scroll.current!.getScrollTop()).toBe(0);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  },
);

test.each([
  { paddingY: 1, border: true, nested: false, height: 2 },
  { paddingY: 0, border: true, nested: false, height: 4 },
  { paddingY: 1, paddingBottom: 0, border: true, nested: false, height: 3 },
  { paddingY: 0, border: false, nested: true, height: 6 },
])(
  "a shrunken ancestor clips the scroll viewport to its content area: %j",
  async ({ paddingY, paddingBottom, border, nested, height }) => {
    const clock = FakeTimers.install({
      now: 1000,
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const terminal = createTerminal(30, 10, (ms) => clock.tick(ms));
    const scroll = createRef<ScrollBoxHandle>();
    const content = (
      <ScrollBox height={13} ref={scroll}>
        <Box flexShrink={0}>
          <Text>{Array.from({ length: 20 }, (_, i) => `body-${i}`).join("\n")}</Text>
        </Box>
      </ScrollBox>
    );
    const app = renderSync(
      <AlternateScreen>
        <Box height={10} flexDirection="column">
          <Box
            height={13}
            flexShrink={1}
            flexDirection="column"
            width={30}
            paddingY={paddingY}
            {...(paddingBottom === undefined ? {} : { paddingBottom })}
            borderStyle={border ? "single" : undefined}
          >
            {nested ? (
              <Box height={13} width={30} flexDirection="column" flexShrink={1}>
                {content}
              </Box>
            ) : (
              content
            )}
          </Box>
          <Box flexShrink={0}>
            <Text>{"footer-1\nfooter-2\nfooter-3\nfooter-4"}</Text>
          </Box>
        </Box>
      </AlternateScreen>,
      terminal,
    );
    try {
      await terminal.flush();
      expect(scroll.current!.getViewportHeight()).toBe(height);
      expect(terminal.screen().slice(6)).toEqual(["footer-1", "footer-2", "footer-3", "footer-4"]);
      if (border) expect(terminal.screen()[5]).toBe("└" + "─".repeat(28) + "┘");
      scroll.current!.scrollToBottom();
      await terminal.waitFor(() => terminal.screen().some((line) => line.includes("body-19")));
      expect(scroll.current!.getScrollTop()).toBe(20 - height);
      expect(terminal.screen().slice(6)).toEqual(["footer-1", "footer-2", "footer-3", "footer-4"]);
      if (border) expect(terminal.screen()[5]).toBe("└" + "─".repeat(28) + "┘");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
      clock.uninstall();
    }
  },
);

test("a tall active viewport follows growth, contraction and regrowth without shell scrollback", async () => {
  const terminal = createTerminal(8, 3);
  const tree = (text: string) => (
    <AlternateScreen>
      <ScrollBox height={3} stickyScroll>
        <Box flexShrink={0}>
          <Text>{text}</Text>
        </Box>
      </ScrollBox>
    </AlternateScreen>
  );
  const app = renderSync(tree("old1\nold2\nold3\nold4"), terminal);
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["old2", "old3", "old4"]);
    app.rerender(tree("new1\nnew2\nnew3\nnew4\nnew5"));
    await terminal.waitFor(() => terminal.screen()[2] === "new5");
    expect(terminal.screen()).toEqual(["new3", "new4", "new5"]);
    expect(terminal.scrollback()).toEqual([]);
    app.rerender(tree("short"));
    await terminal.waitFor(
      () =>
        terminal.screen()[0] === "short" &&
        terminal.screen()[1] === "" &&
        terminal.screen()[2] === "",
    );
    expect(terminal.screen()).toEqual(["short", "", ""]);
    expect(terminal.scrollback()).toEqual([]);
    app.rerender(tree("grow1\ngrow2\ngrow3\ngrow4"));
    await terminal.waitFor(() => terminal.screen()[2] === "grow4");
    expect(terminal.screen()).toEqual(["grow2", "grow3", "grow4"]);
    expect(terminal.scrollback()).toEqual([]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
