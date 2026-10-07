import { expect, test } from "bun:test";
import { useState } from "react";
import { AlternateScreen, Box, Text, TextInput, renderSync as render } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("a long draft scrolls inside its limit and keeps the caret visible during editing", async () => {
  const terminal = createTerminal(20, 8);
  let draft = "";
  function View() {
    const [value, setValue] = useState("");
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexGrow={1}>
          <Text>body</Text>
        </Box>
        <TextInput
          value={value}
          maxLines={3}
          onChange={(next) => {
            draft = next;
            setValue(next);
          }}
        />
        <Text>status</Text>
      </Box>
    );
  }
  const app = render(
    <AlternateScreen>
      <Box height={8} flexDirection="column">
        <View />
      </Box>
    </AlternateScreen>,
    terminal,
  );
  try {
    terminal.stdin.write("\x1b[200~first\nsecond\nthird\nfourth\nfifth\x1b[201~");
    await terminal.waitFor(() => terminal.screen()[6] === "fifth");
    expect(terminal.screen().slice(4)).toEqual(["third", "fourth", "fifth", "status"]);
    expect(terminal.screen()[3]).toBe("");
    expect(terminal.cursor()).toEqual({ x: 5, y: 6 });
    terminal.stdin.write("\x1b[A\x1b[H!");
    await terminal.waitFor(() => terminal.screen()[5] === "!fourth");
    expect(draft).toBe("first\nsecond\nthird\n!fourth\nfifth");
    expect(terminal.cursor()).toEqual({ x: 1, y: 5 });
    terminal.stdin.write("\x1b[A\x1b[A\x1b[A\x1b[H");
    await terminal.waitFor(() => terminal.screen()[4] === "first");
    expect(terminal.cursor()).toEqual({ x: 0, y: 4 });
    expect(terminal.screen()[7]).toBe("status");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("vertical editing can visit empty lines and the end of a shorter line", async () => {
  const terminal = createTerminal(20, 6);
  const app = render(<TextInput value={"long first\n\nlast"} onChange={() => {}} />, terminal);
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[A");
    await terminal.waitFor(() => terminal.cursor().y === 1);
    expect(terminal.cursor()).toEqual({ x: 0, y: 1 });
    terminal.stdin.write("\x1b[A\x1b[F\x1b[B");
    await terminal.waitFor(() => terminal.cursor().y === 1);
    expect(terminal.cursor()).toEqual({ x: 0, y: 1 });
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
