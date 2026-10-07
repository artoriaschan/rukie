import { expect, test } from "bun:test";
import { useLayoutEffect, useRef } from "react";
import {
  AlternateScreen,
  Box,
  ScrollBox,
  Text,
  renderSync,
  type DOMElement,
  type ScrollBoxHandle,
} from "../../../src/ink/index.ts";
import { createTerminal } from "../helpers/terminal";

test("nested source seeks use the fresh layout during growth and preserve later bottom follow", async () => {
  const terminal = createTerminal(30, 8);
  const observed: { scroll: ScrollBoxHandle | null } = { scroll: null };
  function Content({ count, seek }: { count: number; seek?: number }) {
    const target = useRef<DOMElement>(null);
    const handle = useRef<ScrollBoxHandle>(null);
    useLayoutEffect(() => {
      observed.scroll = handle.current;
      if (seek !== undefined && target.current) handle.current?.scrollToElement(target.current);
    }, [count, seek]);
    return (
      <ScrollBox ref={handle} height={5} stickyScroll>
        <Box flexShrink={0} height={3}>
          <Text>header</Text>
        </Box>
        <Box flexShrink={0} flexDirection="column">
          {Array.from({ length: count }, (_, index) => (
            <Box key={index} ref={index === seek ? target : undefined} flexShrink={0}>
              <Text>{`source-${index}`}</Text>
            </Box>
          ))}
        </Box>
      </ScrollBox>
    );
  }
  const tree = (count: number, seek?: number) => (
    <AlternateScreen>
      <Content count={count} seek={seek} />
    </AlternateScreen>
  );
  const app = renderSync(tree(3), { ...terminal, patchConsole: false, exitOnCtrlC: false });
  try {
    await terminal.waitFor(() => terminal.screen().some((row) => row.includes("source-2")));
    app.rerender(tree(30, 12));
    await terminal.waitFor(() => terminal.screen()[0] === "source-12");
    expect(observed.scroll?.getScrollTop()).toBe(15);
    expect(observed.scroll?.isSticky()).toBe(false);
    observed.scroll?.scrollTo(7);
    app.rerender(tree(35));
    await terminal.waitFor(() => terminal.screen()[0] === "source-4");
    expect(observed.scroll?.getScrollTop()).toBe(7);
    observed.scroll?.scrollToBottom();
    await terminal.waitFor(() => terminal.screen().some((row) => row === "source-34"));
    app.rerender(tree(40));
    await terminal.waitFor(() => terminal.screen().some((row) => row === "source-39"));
    expect(observed.scroll?.isSticky()).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
