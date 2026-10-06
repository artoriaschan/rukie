import { expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";
import { Box, Text, ThemeProvider, dark, light, render } from "@neant/tui";
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

test.each([false, true])(
  "temporary tip floats above the prompt without moving it (compact=%s)",
  async (compact) => {
    const terminal = createTerminal(40, 12);
    let dismiss = () => {};
    function View() {
      const [tip, setTip] = useState<string | undefined>("再按一次 Esc 回退");
      useLayoutEffect(() => {
        dismiss = () => setTip(undefined);
      }, []);
      return (
        <Box flexDirection="column">
          <Text>{"P".repeat(40)}</Text>
          <PromptInput
            compact={compact}
            columns={40}
            maxLines={1}
            value="中文 draft"
            onChange={() => {}}
            onSubmit={() => {}}
            tip={tip}
          />
        </Box>
      );
    }
    const app = render(<View />, terminal);
    try {
      await terminal.flush();
      const row = compact ? 0 : 1;
      const prefix = compact ? "P".repeat(22) : " ".repeat(22);
      expect(terminal.screen()[row]).toBe(prefix + "再按一次 Esc 回退" + (compact ? "P" : ""));
      const buffer = terminal.terminal.buffer.active;
      const cursor = [buffer.cursorX, buffer.cursorY];
      const input = terminal.screen().findIndex((line) => line.includes("❯ 中文 draft"));
      dismiss();
      await terminal.waitFor(() => !terminal.screen().some((line) => line.includes("再按一次")));
      expect(terminal.screen()[0]).toBe("P".repeat(40));
      expect(terminal.screen().findIndex((line) => line.includes("❯ 中文 draft"))).toBe(input);
      expect([buffer.cursorX, buffer.cursorY]).toEqual(cursor);
      expect(terminal.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  },
);

test("replacing a tip starts a fresh lifetime without an old timeout hiding it or moving the editor", async () => {
  const terminal = createTerminal(40, 12);
  let replace = (_tip?: string) => {};
  let notify = (_notice?: { text: string; warning: boolean }) => {};
  function View() {
    const [tip, setTip] = useState<string | undefined>("First tip");
    const [notice, setNotice] = useState<{ text: string; warning: boolean }>();
    useLayoutEffect(() => {
      replace = setTip;
      notify = setNotice;
    }, []);
    return (
      <Box flexDirection="column">
        <Text>{"P".repeat(40)}</Text>
        <PromptInput
          compact
          columns={40}
          maxLines={1}
          value="中文 draft"
          onChange={() => {}}
          onSubmit={() => {}}
          tip={tip}
          notice={notice}
        />
      </Box>
    );
  }
  const app = render(<View />, terminal);
  try {
    await terminal.waitFor(() => terminal.screen()[0]!.includes("First tip"));
    const shownAt = performance.now();
    const buffer = terminal.terminal.buffer.active;
    const cursor = [buffer.cursorX, buffer.cursorY];
    const inputRow = terminal.screen().indexOf("❯ 中文 draft");
    await terminal.waitFor(() => performance.now() - shownAt >= 9000, 9500);
    replace("Replacement tip");
    await terminal.waitFor(() => terminal.screen()[0]!.includes("Replacement tip"));
    await terminal.waitFor(() => performance.now() - shownAt >= 10500, 2000);
    expect(terminal.screen()[0]).toContain("Replacement tip");
    expect(terminal.screen().indexOf("❯ 中文 draft")).toBe(inputRow);
    expect([buffer.cursorX, buffer.cursorY]).toEqual(cursor);
    notify({ text: "Persistent notice", warning: false });
    await terminal.waitFor(() => terminal.screen().join("\n").includes("Persistent notice"));
    expect(terminal.screen().join("\n")).not.toContain("Replacement tip");
    replace(undefined);
    notify(undefined);
    await terminal.waitFor(() => terminal.screen()[0] === "P".repeat(40));
    replace("Replacement tip");
    await terminal.waitFor(() => terminal.screen()[0]!.includes("Replacement tip"));
    expect(terminal.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
}, 15000);
