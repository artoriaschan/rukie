import { expect, test } from "bun:test";
import { ThemedBox, ThemedText, ThemeProvider, dark, render, useTheme } from "../../../src/ink";
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
      <ThemedText color="barSystem">S</ThemedText>
      <ThemedText color="barPrompt">P</ThemedText>
      <ThemedText color="barAssistant">A</ThemedText>
      <ThemedText color="barThinking">T</ThemedText>
      <ThemedText color="barTools">T</ThemedText>
      <ThemedText color="barFree">F</ThemedText>
      <ThemedText color="barFreeText">R</ThemedText>
    </ThemedText>,
    terminal,
  );
  try {
    await terminal.flush();
    const line = terminal.terminal.buffer.active.getLine(0)!;
    expect(Array.from({ length: 19 }, (_, x) => line.getCell(x)!.getFgColor())).toEqual([
      0xe8e6e0, 0x5e6673, 0x7da1de, 0x7da1de, 0xc6d8f8, 0xabc2ec, 0x82b89d, 0xda8a93, 0xd8b270,
      0x55606f, 0x7da1de, 0xd7e4ff, 0x22305f, 0x2b3d78, 0x344a92, 0x4d6bfe, 0x5a7cff, 0x2e3440,
      0x8d95a6,
    ]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("ThemedText resolves bar theme tokens to terminal background colors", async () => {
  const terminal = createTerminal(20, 2);
  const app = render(
    <ThemedText color="barFreeText">
      <ThemedText backgroundColor="barSystem">S</ThemedText>
      <ThemedText backgroundColor="barPrompt">P</ThemedText>
      <ThemedText backgroundColor="barAssistant">A</ThemedText>
      <ThemedText backgroundColor="barThinking">T</ThemedText>
      <ThemedText backgroundColor="barTools">T</ThemedText>
      <ThemedText backgroundColor="barFree">F</ThemedText>
      <ThemedText backgroundColor="barFreeText">R</ThemedText>
    </ThemedText>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("SPATTFR");
    const line = terminal.terminal.buffer.active.getLine(0)!;
    expect(Array.from({ length: 7 }, (_, x) => line.getCell(x)!.getBgColor())).toEqual([
      0x22305f, 0x2b3d78, 0x344a92, 0x4d6bfe, 0x5a7cff, 0x2e3440, 0x8d95a6,
    ]);
    expect(line.getCell(0)!.getFgColor()).toBe(0x8d95a6);
    expect(terminal.output()).toContain(";48;2;34;48;95m");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("ThemedText uses provider backgrounds, preserves raw colors and inherits unset backgrounds", async () => {
  const terminal = createTerminal(20, 2);
  const app = render(
    <ThemeProvider theme={{ ...dark, barPrompt: "#112233", accent: "#445566" }}>
      <ThemedBox color="accent">
        <ThemedText backgroundColor="barPrompt">
          A<ThemedText backgroundColor="#abcdef">B</ThemedText>
          <ThemedText backgroundColor="blue">C</ThemedText>
          <ThemedText>D</ThemedText>
        </ThemedText>
        <ThemedText>E</ThemedText>
        <ThemedText backgroundColor="accent">F</ThemedText>
      </ThemedBox>
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("ABCDEF");
    const line = terminal.terminal.buffer.active.getLine(0)!;
    expect(Array.from({ length: 6 }, (_, x) => line.getCell(x)!.getBgColor())).toEqual([
      0x112233, 0xabcdef, 4, 0x112233, -1, 0x445566,
    ]);
    expect(line.getCell(4)!.isBgDefault()).toBe(true);
    expect(line.getCell(0)!.getFgColor()).toBe(0x445566);
    expect(terminal.output()).toContain(";48;2;17;34;51m");
    expect(terminal.output()).toContain(";48;2;171;205;239m");
    expect(terminal.output()).toContain(";44m");
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
