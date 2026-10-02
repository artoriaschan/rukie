import { expect, test } from "bun:test";
import { ThemedBox, ThemedText, ThemeProvider, dark, render, useTheme } from "../../src";
import { createTerminal } from "../helpers/terminal";

test("ThemedText resolves dark theme tokens to terminal foreground colors", async () => {
  const terminal = createTerminal(20, 2);
  const app = render(
    <ThemedText>
      <ThemedText color="text">T</ThemedText>
      <ThemedText color="subtle">S</ThemedText>
      <ThemedText color="accent">A</ThemedText>
      <ThemedText color="activity">A</ThemedText>
      <ThemedText color="activityFlash">F</ThemedText>
      <ThemedText color="permission">P</ThemedText>
      <ThemedText color="success">S</ThemedText>
      <ThemedText color="error">E</ThemedText>
      <ThemedText color="warning">W</ThemedText>
      <ThemedText color="promptBorder">B</ThemedText>
      <ThemedText color="logoFrom">F</ThemedText>
      <ThemedText color="logoTo">T</ThemedText>
    </ThemedText>,
    terminal,
  );
  try {
    await terminal.flush();
    const line = terminal.terminal.buffer.active.getLine(0)!;
    expect(Array.from({ length: 12 }, (_, x) => line.getCell(x)!.getFgColor())).toEqual([
      0xe8e6e0, 0x5e6673, 0x7da1de, 0x7da1de, 0xc6d8f8, 0xabc2ec, 0x82b89d, 0xda8a93, 0xd8b270,
      0x55606f, 0x7da1de, 0xd7e4ff,
    ]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("ThemeProvider supplies tokens and ThemedBox scopes colors without leaking to siblings", async () => {
  const terminal = createTerminal(20, 2);
  function View() {
    const theme = useTheme();
    return (
      <ThemedBox>
        <ThemedBox color="accent">
          <ThemedText>A</ThemedText>
          <ThemedBox color="#123456">
            <ThemedText>B</ThemedText>
          </ThemedBox>
          <ThemedText color="error">C</ThemedText>
          <ThemedText color="blue">D</ThemedText>
        </ThemedBox>
        <ThemedText color={theme.text}>E</ThemedText>
      </ThemedBox>
    );
  }
  const app = render(
    <ThemeProvider theme={{ ...dark, accent: "#112233", text: "#445566" }}>
      <View />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("ABCDE");
    const line = terminal.terminal.buffer.active.getLine(0)!;
    expect(Array.from({ length: 5 }, (_, x) => line.getCell(x)!.getFgColor())).toEqual([
      0x112233, 0x123456, 0xda8a93, 4, 0x445566,
    ]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
