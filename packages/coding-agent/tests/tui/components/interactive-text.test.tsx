import FakeTimers from "@sinonjs/fake-timers";
import { expect, test } from "bun:test";
import { Box, ScrollBox, Text, ThemeProvider } from "../../../src/ink/index.ts";
import { InteractiveText } from "../../../src/tui/components/interactive-text";
import { renderComponent } from "../helpers/render-component";
import { createTerminal } from "../helpers/terminal";

test.each([
  [0, 0],
  [1, 1],
] as const)(
  "leading blank keeps the action glyph at its painted column %i",
  async (column, expected) => {
    const terminal = createTerminal(20, 8);
    let clicks = 0;
    const app = renderComponent(
      <ThemeProvider>
        <InteractiveText noSelect onClick={() => clicks++}>
          {" ⤢"}
        </InteractiveText>
      </ThemeProvider>,
      terminal,
    );
    try {
      await terminal.waitFor(() => terminal.screen()[0] === " ⤢");
      terminal.stdin.write(`\x1b[<0;${column + 1};1M\x1b[<0;${column + 1};1m`);
      await terminal.flush();
      expect(clicks).toBe(expected);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  },
);

test("InteractiveText clicks target painted graphemes and exclude whitespace after wrapping and resize", async () => {
  const clock = FakeTimers.install({
    now: 1000,
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const terminal = createTerminal(8, 6, (ms) => clock.tick(ms));
  const clicks: string[] = [];
  const app = renderComponent(
    <Box flexDirection="column">
      <InteractiveText onClick={() => clicks.push("text")}>
        <Text bold>界é</Text>
        {" \n  end"}
      </InteractiveText>
      <Box width={8} height={1} onClick={() => clicks.push("box")}>
        <Text>path</Text>
      </Box>
    </Box>,
    terminal,
  );
  const click = async (x: number, y: number) => {
    // Each action here is an independent click, outside the native 500ms multi-click window.
    clock.tick(501);
    terminal.stdin.write(`\x1b[<0;${x};${y}M\x1b[<0;${x};${y}m`);
    await terminal.flush();
  };
  try {
    await terminal.flush();
    await click(1, 1);
    await click(2, 1);
    await click(3, 1);
    expect(clicks).toEqual(["text", "text", "text"]);
    await click(4, 1);
    await click(8, 1);
    await click(1, 2);
    await click(2, 2);
    expect(clicks).toHaveLength(3);
    await click(3, 2);
    await click(8, 3);
    expect(clicks).toEqual(["text", "text", "text", "text", "box"]);
    terminal.resize(3, 6);
    await terminal.waitFor(() => terminal.screen()[3] === "end");
    expect(terminal.screen()).toEqual(["界é", "", "", "end", "pat", "h"]);
    await click(3, 1);
    expect(clicks.at(-1)).toBe("text");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
    clock.uninstall();
  }
});

test("InteractiveText clicks exclude wide glyphs omitted at a ScrollBox clip boundary", async () => {
  const terminal = createTerminal(8, 4);
  let clicks = 0;
  const app = renderComponent(
    <ScrollBox width={1} height={1}>
      <Box width={2}>
        <InteractiveText onClick={() => clicks++}>界</InteractiveText>
      </Box>
    </ScrollBox>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[0]).not.toContain("界");
    terminal.stdin.write("\x1b[<0;1;1M\x1b[<0;1;1m");
    await terminal.flush();
    expect(clicks).toBe(0);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
