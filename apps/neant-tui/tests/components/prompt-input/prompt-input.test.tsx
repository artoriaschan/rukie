import { expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";
import { ThemeProvider, dark, light, render } from "@neant/tui";
import { PromptInput } from "../../../src/components/prompt-input/prompt-input";
import { createTerminal } from "../../helpers/terminal";

test("the prompt matches dsh's rounded edges, gap, themed text and working prefix", async () => {
  const terminal = createTerminal(40, 12);
  let work = () => {};
  function View() {
    const [working, setWorking] = useState(false);
    const [value, setValue] = useState("");
    useLayoutEffect(() => {
      work = () => setWorking(true);
    }, []);
    return (
      <PromptInput
        columns={40}
        maxLines={1}
        working={working}
        value={value}
        onChange={setValue}
        onSubmit={() => {}}
      />
    );
  }
  const app = render(
    <ThemeProvider theme={{ ...dark, text: "#112233", promptBorder: "#445566" }}>
      <View />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen().slice(0, 4)).toEqual([
      "",
      `╭${"─".repeat(38)}╮`,
      "❯",
      `╰${"─".repeat(38)}╯`,
    ]);
    const buffer = terminal.terminal.buffer.active;
    expect(buffer.getLine(1)!.getCell(0)!.getFgColor()).toBe(0x445566);
    expect(buffer.getLine(2)!.getCell(0)!.getFgColor()).toBe(0x112233);
    expect(buffer.getLine(2)!.getCell(2)!.isInverse()).toBeTruthy();
    expect(buffer.cursorX).toBe(2);
    expect(buffer.cursorY).toBe(2);
    terminal.stdin.write("中文A\x1b[D");
    await terminal.waitFor(() => terminal.screen()[2] === "❯ 中文A" && buffer.cursorX === 6);
    expect(buffer.getLine(2)!.getCell(2)!.getFgColor()).toBe(0x112233);
    expect(buffer.getLine(2)!.getCell(2)!.isInverse()).toBeFalsy();
    expect(buffer.getLine(2)!.getCell(6)!.isInverse()).toBeTruthy();
    work();
    await terminal.waitFor(() => !!buffer.getLine(2)!.getCell(0)!.isDim());
    expect(buffer.getLine(2)!.getCell(2)!.isDim()).toBeFalsy();
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test.each([
  [dark, 0xb49adc],
  [light, 0x7856a8],
] as const)("Plan Mode uses the palette's plan border color", async (theme, expected) => {
  const terminal = createTerminal(40, 12);
  const app = render(
    <ThemeProvider theme={theme}>
      <PromptInput
        columns={40}
        maxLines={1}
        planMode
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
      />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.terminal.buffer.active.getLine(1)!.getCell(0)!.getFgColor()).toBe(expected);
    expect(terminal.terminal.buffer.active.getLine(3)!.getCell(0)!.getFgColor()).toBe(expected);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
