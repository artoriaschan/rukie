import { expect, test } from "bun:test";
import { ThemeProvider } from "../../../src/ink/index.ts";
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
