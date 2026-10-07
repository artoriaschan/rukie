import { expect, test } from "bun:test";
import { createRef } from "react";
import {
  AlternateScreen,
  Box,
  ScrollBox,
  Text,
  renderSync,
  type ScrollBoxHandle,
  useInput,
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
    useInput(() => {});
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

test("width reflow restores the visible source offset while browsing", async () => {
  const terminal = createTerminal(20, 4);
  const scroll = createRef<ScrollBoxHandle>();
  let sources!: Sources;
  function Reader() {
    useInput(() => {});
    sources = useSources();
    return (
      <AlternateScreen>
        <ScrollBox height={3} ref={scroll}>
          <Box flexShrink={0} width="100%" ref={sources.ref("reader")}>
            <Text>
              AA BB CC DD EE FF GG HH II JJ KK LL MM NN OO PP QQ RR SS TT UU VV WW XX YY ZZ
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text>last message</Text>
          </Box>
        </ScrollBox>
        <Text>dock</Text>
      </AlternateScreen>
    );
  }
  const app = renderSync(<Reader />, terminal);
  try {
    await terminal.flush();
    scroll.current!.scrollTo(1);
    await terminal.waitFor(() => terminal.screen()[0]?.trim() === "HH II JJ KK LL MM");
    const saved = captureSourcePosition(readPosition(scroll.current, 20)!, sources);
    terminal.resize(14, 4);
    await terminal.waitFor(
      () => sources.elements.get("reader")?.yogaNode?.getComputedWidth() === 14,
    );
    restoreSourcePosition(scroll.current, sources, saved);
    await terminal.waitFor(() => terminal.screen()[0] === " FF GG HH II");
    expect(terminal.screen()[3]).toBe("dock");
    expect(scroll.current!.isSticky()).toBe(false);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("resize preserves a source reading position on an empty line", async () => {
  const terminal = createTerminal(20, 4);
  const scroll = createRef<ScrollBoxHandle>();
  let sources!: Sources;
  function Reader() {
    useInput(() => {});
    sources = useSources();
    return (
      <AlternateScreen>
        <ScrollBox height={3} ref={scroll}>
          <Box flexShrink={0} width="100%" ref={sources.ref("reader")}>
            <Text>{"first\n\nthird\nfourth\nfifth\nsixth\nseventh"}</Text>
          </Box>
        </ScrollBox>
        <Text>dock</Text>
      </AlternateScreen>
    );
  }
  const app = renderSync(<Reader />, terminal);
  try {
    await terminal.flush();
    scroll.current!.scrollTo(1);
    await terminal.waitFor(() => terminal.screen()[1] === "third");
    expect(terminal.screen()).toEqual(["", "third", "fourth", "dock"]);
    const saved = captureSourcePosition(readPosition(scroll.current, 20)!, sources);
    terminal.resize(14, 4);
    await terminal.waitFor(
      () => sources.elements.get("reader")?.yogaNode?.getComputedWidth() === 14,
    );
    restoreSourcePosition(scroll.current, sources, saved);
    await terminal.flush();
    expect(terminal.screen()).toEqual(["", "third", "fourth", "dock"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("portable product source identity distinguishes duplicate content after remount and reflow with top fallback and follow", async () => {
  const terminal = createTerminal(20, 4);
  const scroll = createRef<ScrollBoxHandle>();
  let sources!: Sources;
  const duplicate = "AA BB CC DD EE FF GG HH II JJ KK LL MM NN OO PP QQ RR SS TT UU VV WW XX YY ZZ";
  function Reader({ first = true, second = true }: { first?: boolean; second?: boolean }) {
    useInput(() => {});
    sources = useSources();
    return (
      <AlternateScreen>
        <ScrollBox height={3} ref={scroll} stickyScroll>
          {first && (
            <Box flexShrink={0} width="100%" ref={sources.ref("first")}>
              <Text>{duplicate}</Text>
            </Box>
          )}
          {second && (
            <Box flexShrink={0} width="100%" ref={sources.ref("second")}>
              <Box width={2}>
                <Text>❯</Text>
              </Box>
              <Box flexGrow={1}>
                <Text>{duplicate}</Text>
              </Box>
            </Box>
          )}
          <Box flexShrink={0}>
            <Text>{"end-1\nend-2\nend-3\nend-4\nend-5\nend-6\nend-7\nend-8"}</Text>
          </Box>
        </ScrollBox>
        <Text>dock</Text>
      </AlternateScreen>
    );
  }
  const app = renderSync(<Reader />, terminal);
  try {
    await terminal.waitFor(() => terminal.screen()[2] === "end-8");
    const following = captureSourcePosition(readPosition(scroll.current, 20)!, sources);
    expect(following.following).toBe(true);
    app.rerender(
      <AlternateScreen>
        <Text>panel</Text>
      </AlternateScreen>,
    );
    await terminal.waitFor(() => terminal.screen()[0] === "panel");
    app.rerender(<Reader />);
    await terminal.waitFor(() => terminal.screen()[2] === "end-8");
    restoreSourcePosition(scroll.current, sources, following);
    await terminal.flush();
    expect(terminal.screen()[2]).toBe("end-8");
    scroll.current!.scrollTo(5);
    await terminal.waitFor(() => terminal.screen()[0] === "  GG HH II JJ KK LL");
    const saved = captureSourcePosition(readPosition(scroll.current, 20)!, sources);
    expect(saved.anchor?.id).toBe("second");
    expect(saved.following).toBe(false);
    app.rerender(
      <AlternateScreen>
        <Text>panel</Text>
      </AlternateScreen>,
    );
    await terminal.waitFor(() => terminal.screen()[0] === "panel");
    terminal.resize(14, 4);
    app.rerender(<Reader first={false} />);
    await terminal.waitFor(
      () =>
        sources.elements.has("second") &&
        sources.elements.get("second")?.yogaNode?.getComputedWidth() === 14,
    );
    restoreSourcePosition(scroll.current, sources, saved);
    await terminal.waitFor(() => terminal.screen()[0] === "  EE FF GG HH");
    const fallback = captureSourcePosition(readPosition(scroll.current, 14)!, sources);
    app.rerender(
      <AlternateScreen>
        <Text>panel</Text>
      </AlternateScreen>,
    );
    await terminal.waitFor(() => terminal.screen()[0] === "panel");
    app.rerender(<Reader first={false} second={false} />);
    await terminal.waitFor(() => scroll.current?.getScrollHeight() === 8);
    restoreSourcePosition(scroll.current, sources, fallback);
    await terminal.waitFor(() => terminal.screen()[0] === `end-${fallback.top + 1}`);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
