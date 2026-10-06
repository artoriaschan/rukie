import { expect, test } from "bun:test";
import { createRef, useState } from "react";
import { Box, ScrollBox, Text, render, type ScrollHandle } from "../../src";
import { createTerminal } from "../helpers/terminal";

test.each([true, false])(
  "followOnReachBottom=%s controls later growth after fitting content and explicit bottom reading",
  async (followOnReachBottom) => {
    const terminal = createTerminal(20, 4);
    const scroll = createRef<ScrollHandle>();
    let update = (_count: number) => {};
    function View() {
      const [count, setCount] = useState(1);
      update = setCount;
      return (
        <Box flexDirection="column" height={4}>
          <Text>header</Text>
          <ScrollBox ref={scroll} initialFollow={false} followOnReachBottom={followOnReachBottom}>
            <Text>{Array.from({ length: count }, (_, index) => `line ${index}`).join("\n")}</Text>
          </ScrollBox>
          <Text>footer</Text>
        </Box>
      );
    }
    const app = render(<View />, { ...terminal, fullscreen: true });
    try {
      await terminal.flush();
      expect(terminal.screen()).toEqual(["header", "line 0", "", "footer"]);
      update(10);
      await terminal.waitFor(() => scroll.current!.getSnapshot().total === 10);
      expect(terminal.screen()).toEqual(
        followOnReachBottom
          ? ["header", "line 8", "line 9", "footer"]
          : ["header", "line 0", "line 1", "footer"],
      );
      scroll.current!.scrollToBottom();
      await terminal.waitFor(() => terminal.screen()[2] === "line 9");
      update(11);
      await terminal.waitFor(() => scroll.current!.getSnapshot().total === 11);
      expect(terminal.screen()).toEqual(
        followOnReachBottom
          ? ["header", "line 9", "line 10", "footer"]
          : ["header", "line 8", "line 9", "footer"],
      );
      update(1);
      await terminal.waitFor(() => terminal.screen()[1] === "line 0");
      expect(scroll.current!.getSnapshot().top).toBe(0);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  },
);
