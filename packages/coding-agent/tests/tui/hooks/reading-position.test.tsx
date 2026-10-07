import { expect, test } from "bun:test";
import { createRef } from "react";
import {
  AlternateScreen,
  Box,
  ScrollBox,
  Text,
  renderSync,
  type ScrollBoxHandle,
} from "../../../src/ink/index.ts";
import {
  captureSourcePosition,
  readPosition,
  restoreSourcePosition,
  sourcePositions,
  usePanelScroll,
  useSources,
  type Sources,
} from "../../../src/tui/hooks/reading-position";
import { createTerminal } from "../../ink/helpers/terminal";

// Source identity is owned by the product; native ScrollBox exposes element seeks.
test.each([false, true])(
  "source identity survives preceding contraction with text remount=%s",
  async (remount) => {
    const terminal = createTerminal(20, 6);
    const scroll = createRef<ScrollBoxHandle>();
    let sources!: Sources;
    function Reader({ count }: { count: number }) {
      sources = useSources();
      const attach = usePanelScroll(scroll, 25, 20);
      return (
        <AlternateScreen>
          <ScrollBox ref={attach} height={6}>
            <Box flexShrink={0} ref={sources.ref("card")}>
              <Text>{Array.from({ length: count }, (_, i) => `card-${i}`).join("\n")}</Text>
            </Box>
            <Box flexShrink={0} ref={sources.ref("reader")}>
              <Text key={remount ? count : "stable"}>
                {Array.from({ length: 30 }, (_, i) => `reader-${i}`).join("\n")}
              </Text>
            </Box>
          </ScrollBox>
        </AlternateScreen>
      );
    }
    const app = renderSync(<Reader count={20} />, terminal);
    try {
      await terminal.waitFor(() => terminal.screen()[0] === "reader-5");
      const before = terminal.screen();
      const position = captureSourcePosition(readPosition(scroll.current, 20)!, sources);
      expect(position.anchor?.id).toBe("reader");
      app.rerender(<Reader count={3} />);
      await terminal.waitFor(() => scroll.current?.getScrollHeight() === 33);
      restoreSourcePosition(scroll.current, sources, position);
      await terminal.waitFor(() => terminal.screen()[0] === "reader-5");
      expect(terminal.screen()).toEqual(before);
      expect(scroll.current!.isSticky()).toBe(false);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  },
);

test("public source geometry and deferred element seek follow wrapped content", async () => {
  const terminal = createTerminal(20, 6);
  const scroll = createRef<ScrollBoxHandle>();
  let sources!: Sources;
  function Reader() {
    sources = useSources();
    return (
      <AlternateScreen>
        <ScrollBox ref={scroll} height={6}>
          <Box flexShrink={0} ref={sources.ref("first")}>
            <Text>{"prefix\n".repeat(10)}</Text>
          </Box>
          <Box flexShrink={0} ref={sources.ref("second")}>
            <Text>target 界面</Text>
          </Box>
          <Box flexShrink={0}>
            <Text>{"tail\n".repeat(10)}</Text>
          </Box>
        </ScrollBox>
      </AlternateScreen>
    );
  }
  const app = renderSync(<Reader />, terminal);
  try {
    await terminal.flush();
    expect(sourcePositions(sources).find((source) => source.id === "second")?.top).toBe(11);
    scroll.current!.scrollToElement(sources.elements.get("second")!);
    await terminal.waitFor(() => terminal.screen()[0] === "target 界面");
    expect(scroll.current!.isSticky()).toBe(false);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("folding away a visible source restores its containing card", async () => {
  const terminal = createTerminal(20, 6);
  const scroll = createRef<ScrollBoxHandle>();
  let sources!: Sources;
  function Reader({ expanded }: { expanded: boolean }) {
    sources = useSources();
    const attach = usePanelScroll(scroll, 25, 20);
    return (
      <AlternateScreen>
        <ScrollBox ref={attach} height={6}>
          <Box flexShrink={0}>
            <Text>
              {Array.from({ length: expanded ? 20 : 3 }, (_, i) => `prior-${i}`).join("\n")}
            </Text>
          </Box>
          <Box flexDirection="column" flexShrink={0} ref={sources.ref("card")}>
            <Text>card-header</Text>
            {expanded && (
              <Box flexShrink={0} ref={sources.ref("card-body")}>
                <Text>{Array.from({ length: 20 }, (_, i) => `body-${i}`).join("\n")}</Text>
              </Box>
            )}
          </Box>
          <Box flexShrink={0}>
            <Text>{Array.from({ length: 30 }, (_, i) => `tail-${i}`).join("\n")}</Text>
          </Box>
        </ScrollBox>
      </AlternateScreen>
    );
  }
  const app = renderSync(<Reader expanded />, terminal);
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "body-4");
    const position = captureSourcePosition(readPosition(scroll.current, 20)!, sources);
    expect(position.anchor?.id).toBe("card-body");
    app.rerender(<Reader expanded={false} />);
    await terminal.waitFor(() => scroll.current?.getScrollHeight() === 34);
    restoreSourcePosition(scroll.current, sources, position);
    await terminal.waitFor(() => terminal.screen()[0] === "card-header");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
