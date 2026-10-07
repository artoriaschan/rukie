import { expect, test } from "bun:test";
import { Box, ThemedText } from "../../../../src/ink";
import { ExitButton } from "../../../../src/tui/components/subagent-dashboard";
import { renderComponent } from "../../helpers/render-component";
import { createTerminal } from "../../helpers/terminal";

test("the exit glyph closes the scene from its measured header position", async () => {
  const terminal = createTerminal(80, 12);
  let closes = 0;
  const app = renderComponent(
    <Box paddingX={2}>
      <ThemedText>🔴 Subagent: Clickable · Run aborted</ThemedText>
      <Box flexGrow={1} />
      <ExitButton onClick={() => closes++} />
    </Box>,
    { ...terminal, patchConsole: false },
  );
  try {
    await terminal.flush();
    const column = terminal.screen()[0]!.indexOf("✕");
    expect(column).toBeGreaterThan(0);
    terminal.stdin.write(`\x1b[<0;${column + 1};1M\x1b[<0;${column + 1};1m`);
    await terminal.waitFor(() => closes === 1);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
