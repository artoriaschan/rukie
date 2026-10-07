import { expect, test, jest } from "bun:test";
import { createRef, useState } from "react";
import { Box, ScrollBox, Text, render, type ScrollHandle } from "../../../src/ink";
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

test("same-width contraction above the viewport retains its stable visible source", async () => {
  const terminal = createTerminal(40, 8);
  const scroll = createRef<ScrollHandle>();
  let collapse = () => {};
  function View() {
    const [expanded, setExpanded] = useState(true);
    collapse = () => setExpanded(false);
    return (
      <Box height={8} flexDirection="column">
        <Text>fixed header</Text>
        <ScrollBox ref={scroll} initialFollow={false} followOnReachBottom={false} initialTop={25}>
          <Box scrollAnchorId="preceding-card">
            <Text>
              {Array.from({ length: expanded ? 20 : 3 }, (_, i) => `card-${i}`).join("\n")}
            </Text>
          </Box>
          <Box scrollAnchorId="reading-message">
            <Text>{Array.from({ length: 30 }, (_, i) => `reader-${i}`).join("\n")}</Text>
          </Box>
        </ScrollBox>
        <Text>fixed footer</Text>
      </Box>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    await terminal.waitFor(() => terminal.screen()[1] === "reader-5");
    const before = terminal.screen().slice(1, 7);
    collapse();
    await terminal.waitFor(() => scroll.current?.getSnapshot().total === 33);
    expect(terminal.screen().slice(1, 7)).toEqual(before);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("public anchor geometry and deferred seek follow current wrapped content", async () => {
  const terminal = createTerminal(20, 6);
  const scroll = createRef<ScrollHandle>();
  const app = render(
    <ScrollBox ref={scroll} initialFollow={false}>
      <Box scrollAnchorId="first">
        <Text>{"prefix\n".repeat(10)}</Text>
      </Box>
      <Box scrollAnchorId="second">
        <Text>target 界面</Text>
      </Box>
      <Text>{"tail\n".repeat(10)}</Text>
    </ScrollBox>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    expect(
      scroll.current?.getSnapshot().anchors?.find((anchor) => anchor.id === "second")?.top,
    ).toBe(11);
    scroll.current!.scrollToAnchor("second");
    await terminal.waitFor(() => terminal.screen()[0] === "target 界面");
    expect(scroll.current!.getSnapshot().following).toBe(false);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("stable box identity retains source when a preceding card contracts and text remounts", async () => {
  const terminal = createTerminal(20, 6);
  let shrink = () => {};
  const scroll = createRef<ScrollHandle>();
  function View() {
    const [count, setCount] = useState(20);
    shrink = () => setCount(3);
    return (
      <ScrollBox ref={scroll} initialFollow={false} initialTop={25} followOnReachBottom={false}>
        <Text>{Array.from({ length: count }, (_, i) => `card-${i}`).join("\n")}</Text>
        <Box scrollAnchorId="reader">
          <Text key={count}>{Array.from({ length: 30 }, (_, i) => `reader-${i}`).join("\n")}</Text>
        </Box>
      </ScrollBox>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "reader-5");
    shrink();
    await terminal.waitFor(() => scroll.current?.getSnapshot().total === 33);
    expect(terminal.screen()[0]).toBe("reader-5");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("folding away the visible source stays on its containing card", async () => {
  const terminal = createTerminal(20, 6);
  const scroll = createRef<ScrollHandle>();
  let fold = () => {};
  function View() {
    const [expanded, setExpanded] = useState(true);
    fold = () => setExpanded(false);
    return (
      <ScrollBox ref={scroll} initialFollow={false} initialTop={25} followOnReachBottom={false}>
        <Text>{Array.from({ length: expanded ? 20 : 3 }, (_, i) => `prior-${i}`).join("\n")}</Text>
        <Box scrollAnchorId="card" flexDirection="column">
          <Text>card-header</Text>
          {expanded && (
            <Box scrollAnchorId="card-body">
              <Text>{Array.from({ length: 20 }, (_, i) => `body-${i}`).join("\n")}</Text>
            </Box>
          )}
        </Box>
        <Text>{Array.from({ length: 30 }, (_, i) => `tail-${i}`).join("\n")}</Text>
      </ScrollBox>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "body-4");
    fold();
    await terminal.waitFor(() => scroll.current?.getSnapshot().total === 34);
    expect(terminal.screen()[0]).toBe("card-header");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test.each([
  { paddingY: 1, border: true, nested: false, height: 2 },
  { paddingY: 0, border: true, nested: false, height: 4 },
  { paddingY: 1, paddingBottom: 0, border: true, nested: false, height: 3 },
  { paddingY: 0, border: false, nested: true, height: 6 },
])(
  "a shrunken ancestor clips the scroll viewport to its content area: %j",
  async ({ paddingY, paddingBottom, border, nested, height }) => {
    jest.useFakeTimers();
    const terminal = createTerminal(30, 10, (ms) => jest.advanceTimersByTime(ms));
    const scroll = createRef<ScrollHandle>();
    const content = (
      <ScrollBox height={13} ref={scroll} initialFollow={false}>
        <Text>{Array.from({ length: 20 }, (_, i) => `body-${i}`).join("\n")}</Text>
      </ScrollBox>
    );
    const app = render(
      <Box height={10} flexDirection="column">
        <Box
          height={13}
          flexShrink={1}
          width={30}
          paddingY={paddingY}
          paddingBottom={paddingBottom}
          borderStyle={border ? "single" : undefined}
        >
          {nested ? (
            <Box height={13} width={30}>
              {content}
            </Box>
          ) : (
            content
          )}
        </Box>
        <Text>{"footer-1\nfooter-2\nfooter-3\nfooter-4"}</Text>
      </Box>,
      { ...terminal, fullscreen: true },
    );
    try {
      await terminal.flush();
      expect(scroll.current!.getSnapshot().height).toBe(height);
      expect(terminal.screen().slice(6)).toEqual(["footer-1", "footer-2", "footer-3", "footer-4"]);
      if (border) expect(terminal.screen()[5]).toBe("└" + "─".repeat(28) + "┘");
      scroll.current!.scrollToBottom();
      await terminal.waitFor(() => terminal.screen().some((line) => line.includes("body-19")));
      expect(scroll.current!.getSnapshot().top).toBe(20 - height);
      expect(terminal.screen().slice(6)).toEqual(["footer-1", "footer-2", "footer-3", "footer-4"]);
      if (border) expect(terminal.screen()[5]).toBe("└" + "─".repeat(28) + "┘");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
      jest.useRealTimers();
    }
  },
);
