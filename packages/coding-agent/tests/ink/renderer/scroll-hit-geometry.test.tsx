import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import {
  AlternateScreen,
  Box,
  ScrollBox,
  Text,
  renderSync,
  useInput,
  type ScrollBoxHandle,
} from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";
function MouseScreen({ children }: { children: ReactNode }) {
  useInput(() => {});
  return <AlternateScreen>{children}</AlternateScreen>;
}

test("clicks follow scrolled cells, exclude clipped rows, and cancel presses across resize", async () => {
  const terminal = createTerminal(20, 6);
  const scroll = { current: null as ScrollBoxHandle | null };
  const clicks: string[] = [];
  const app = renderSync(
    <MouseScreen>
      <Box height={6} flexDirection="column">
        <ScrollBox ref={scroll} height={4} stickyScroll>
          {Array.from({ length: 6 }, (_, index) => (
            <Box key={index} flexShrink={0} height={1} onClick={() => clicks.push(String(index))}>
              <Text>row {index}</Text>
            </Box>
          ))}
        </ScrollBox>
        <Box flexShrink={0} height={2} onClick={() => clicks.push("dock")}>
          <Box
            width={4}
            height={1}
            onClick={(event) => {
              event.stopImmediatePropagation();
              clicks.push("child");
            }}
          >
            <Text>dock</Text>
          </Box>
        </Box>
      </Box>
    </MouseScreen>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[<0;1;1M\x1b[<0;1;1m");
    await terminal.flush();
    expect(clicks).toEqual(["2"]);
    scroll.current!.scrollBy(-2);
    await terminal.waitFor(() => terminal.screen()[0] === "row 0");
    terminal.stdin.write("\x1b[<0;1;1M\x1b[<0;1;1m\x1b[<0;1;5M\x1b[<0;1;5m");
    await terminal.flush();
    expect(clicks).toEqual(["2", "0", "child"]);
    terminal.stdin.write("\x1b[<0;1;1M");
    await terminal.flush();
    const before = terminal.bytesWritten();
    terminal.resize(21, 6);
    await terminal.waitFor(() => terminal.bytesWritten() > before);
    terminal.stdin.write("\x1b[<0;1;1m");
    await terminal.flush();
    expect(clicks).toEqual(["2", "0", "child"]);
    app.unmount();
    terminal.stdin.write("\x1b[<0;1;1M\x1b[<0;1;1m");
    await terminal.flush();
    expect(clicks).toEqual(["2", "0", "child"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("scrolling records new screen rectangles and excludes content clipped behind the dock", async () => {
  const terminal = createTerminal(20, 6);
  const scroll = { current: null as ScrollBoxHandle | null };
  const events: string[] = [];
  const app = renderSync(
    <MouseScreen>
      <Box height={6} flexDirection="column">
        <ScrollBox ref={scroll} height={4} stickyScroll>
          {Array.from({ length: 6 }, (_, index) => (
            <Box
              key={index}
              flexShrink={0}
              height={1}
              onMouseEnter={() => events.push(`${index} enter`)}
              onMouseLeave={() => events.push(`${index} leave`)}
            >
              <Text>row {index}</Text>
            </Box>
          ))}
        </ScrollBox>
        <Box flexShrink={0} height={2} onMouseEnter={() => events.push("dock enter")}>
          <Text>dock</Text>
        </Box>
      </Box>
    </MouseScreen>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["row 2", "row 3", "row 4", "row 5", "dock", ""]);
    terminal.stdin.write("\x1b[<35;1;1M");
    await terminal.flush();
    expect(events).toEqual(["2 enter"]);
    scroll.current!.scrollBy(-2);
    await terminal.waitFor(() => terminal.screen()[0] === "row 0");
    terminal.stdin.write("\x1b[<35;1;2M\x1b[<35;1;5M");
    await terminal.flush();
    expect(events).toEqual(["2 enter", "2 leave", "1 enter", "1 leave", "dock enter"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
