import { expect, test } from "bun:test";
import { useLayoutEffect, useRef } from "react";
import {
  AlternateScreen,
  Box,
  ScrollBox,
  useSelection,
  useInput,
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
    observed.scroll?.scrollTo(2);
    observed.scroll?.scrollToBottom();
    await terminal.waitFor(() => terminal.screen().some((row) => row === "source-34"));
    app.rerender(tree(40));
    await terminal.waitFor(() => terminal.screen().some((row) => row === "source-39"));
    expect(observed.scroll?.isSticky()).toBe(true);
    observed.scroll?.scrollToBottom();
    observed.scroll?.scrollTo(6);
    await terminal.waitFor(() => terminal.screen()[0] === "source-3");
    expect(observed.scroll?.isSticky()).toBe(false);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("a held selection follows mixed viewport origin and height changes without changing its Unicode source", async () => {
  const terminal = createTerminal(30, 12);
  let selected: ReturnType<typeof useSelection> | undefined;
  function Content({ chrome, replacement = false }: { chrome: boolean; replacement?: boolean }) {
    selected = useSelection();
    useInput(() => {});
    const handle = useRef<ScrollBoxHandle>(null);
    useLayoutEffect(() => {
      handle.current?.scrollTo(2);
    }, []);
    return (
      <Box flexDirection="column">
        <Box height={chrome ? 1 : 0} flexShrink={0}>
          <Text>{chrome ? "pinned" : ""}</Text>
        </Box>
        <ScrollBox ref={handle} height={chrome ? 6 : 8} stickyScroll={false}>
          {Array.from({ length: 20 }, (_, index) => (
            <Box key={index} flexShrink={0}>
              <Text>{`${replacement ? "changed" : "row"}-${index}中文🐋`}</Text>
            </Box>
          ))}
        </ScrollBox>
      </Box>
    );
  }
  const tree = (chrome: boolean, replacement = false) => (
    <AlternateScreen>
      <Content chrome={chrome} replacement={replacement} />
    </AlternateScreen>
  );
  const app = renderSync(tree(false), {
    ...terminal,
    patchConsole: false,
    exitOnCtrlC: false,
    selectionIncludeNoSelectCells: false,
  });
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "row-2中文🐋");
    terminal.stdin.write("\x1b[<0;1;3M\x1b[<32;20;4M");
    await terminal.waitFor(() => selected?.hasSelection() === true);
    const original = selected!.readSelectionText();
    expect(original).toBe("row-4中文🐋\nrow-5中文🐋");
    app.rerender(tree(true));
    await terminal.waitFor(() => terminal.screen()[0] === "pinned");
    expect(selected!.readSelectionText()).toBe(original);
    terminal.stdin.write("\x1b[<0;20;5m");
    await terminal.waitFor(() => selected?.getState()?.isDragging === false);
    expect(selected!.readSelectionText()).toBe(original);
    app.rerender(tree(false, true));
    await terminal.waitFor(() => terminal.screen().some((row) => row.includes("changed-4中文🐋")));
    expect(selected!.getState()?.stale).toBe(true);
    expect(selected!.readSelectionText()).toBe("");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("a disabled nested wheel viewport consumes its wheel and resumes with one native step", async () => {
  const terminal = createTerminal(30, 12);
  const observed: { outer: ScrollBoxHandle | null; inner: ScrollBoxHandle | null } = {
    outer: null,
    inner: null,
  };
  function Content({ enabled }: { enabled: boolean }) {
    useInput(() => {});
    useLayoutEffect(() => {
      observed.outer?.scrollTo(0);
      observed.inner?.scrollTo(0);
    }, []);
    return (
      <ScrollBox
        ref={(value) => {
          observed.outer = value;
        }}
        height={8}
        stickyScroll={false}
      >
        <ScrollBox
          ref={(value) => {
            observed.inner = value;
          }}
          height={4}
          flexShrink={0}
          stickyScroll={false}
          wheelEnabled={enabled}
        >
          {Array.from({ length: 20 }, (_, index) => (
            <Box key={index} flexShrink={0}>
              <Text>{`inner-${index}`}</Text>
            </Box>
          ))}
        </ScrollBox>
        {Array.from({ length: 20 }, (_, index) => (
          <Box key={index} flexShrink={0}>
            <Text>{`outer-${index}`}</Text>
          </Box>
        ))}
      </ScrollBox>
    );
  }
  const tree = (enabled: boolean) => (
    <AlternateScreen>
      <Content enabled={enabled} />
    </AlternateScreen>
  );
  const app = renderSync(tree(false), { ...terminal, patchConsole: false, exitOnCtrlC: false });
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "inner-0");
    terminal.stdin.write("\x1b[<65;3;2M");
    await terminal.flush();
    expect(observed.inner!.getScrollTop()).toBe(0);
    expect(observed.outer!.getScrollTop()).toBe(0);
    app.rerender(tree(true));
    await terminal.flush();
    terminal.stdin.write("\x1b[<65;3;2M");
    await terminal.waitFor(() => terminal.screen()[0] === "inner-3");
    expect(observed.inner!.getScrollTop()).toBe(3);
    expect(observed.outer!.getScrollTop()).toBe(0);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
