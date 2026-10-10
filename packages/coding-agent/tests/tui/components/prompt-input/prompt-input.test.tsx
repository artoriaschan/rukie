import { renderComponent } from "../../helpers/render-component";
import { testClock } from "../../helpers/test-clock";
import { expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";
import {
  Box,
  Text,
  ThemeProvider,
  dark,
  light,
  useTerminalSize,
} from "../../../../src/ink/index.ts";
import { PromptInput } from "../../../../src/tui/components/prompt-input/prompt-input";
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
  const app = renderComponent(
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
  const app = renderComponent(
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
    const app = renderComponent(<View />, terminal);
    try {
      // Flushing admitted ANSI does not wait for React's first commit.
      await terminal.waitFor(() => terminal.screen().some((line) => line.includes("❯ 中文 draft")));
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
  testClock.useFakeTimers();
  const terminal = createTerminal(40, 12, (ms) => testClock.advanceTimersByTime(ms));
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
  const app = renderComponent(<View />, terminal);
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
    await terminal.waitFor(() => {
      const painted = terminal.screen().join("\n");
      return painted.includes("Persistent notice") && !painted.includes("Replacement tip");
    });
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
    testClock.useRealTimers();
  }
}, 15000);

test("prompt clicks move the caret and dragging copies only editable Unicode text", async () => {
  testClock.useFakeTimers();
  const terminal = createTerminal(12, 8, (ms) => testClock.advanceTimersByTime(ms));
  const cursor = () => ({
    x: terminal.terminal.buffer.active.cursorX,
    y: terminal.terminal.buffer.active.cursorY,
  });
  const copied: string[] = [];
  const results: string[] = [];
  function View() {
    const { columns } = useTerminalSize();
    const [value, setValue] = useState("中é👩AB\nnext");
    return (
      <PromptInput
        value={value}
        onChange={setValue}
        onSubmit={() => {}}
        columns={columns}
        maxLines={3}
        textSelection={{
          onCopy: async (text) => {
            copied.push(text);
            return true;
          },
          onResult: (result) => results.push(result),
        }}
      />
    );
  }
  const app = renderComponent(<View />, terminal);
  try {
    await terminal.flush();
    // The second cell of Chinese text still targets its complete grapheme.
    terminal.stdin.write("\x1b[<0;4;3M\x1b[<0;4;3m");
    await terminal.waitFor(() => cursor().x === 2 && cursor().y === 2);
    terminal.stdin.write("!");
    await terminal.waitFor(() => terminal.screen()[2] === "❯ !中é👩AB");
    // Trailing blank cells target the logical end of their painted line.
    terminal.stdin.write("\x1b[<0;11;4M\x1b[<0;11;4m");
    await terminal.waitFor(() => cursor().x === 6 && cursor().y === 3);
    terminal.stdin.write("\x1b[<0;4;3M\x1b[<32;9;3M");
    await terminal.waitFor(
      () => !terminal.terminal.buffer.active.getLine(2)!.getCell(3)!.isBgDefault(),
    );
    terminal.stdin.write("\x1b[<0;9;3m");
    testClock.advanceTimersByTime(32);
    await terminal.flush();
    expect(copied).toEqual(["中é👩A"]);
    expect(results).toEqual(["copied"]);
    expect(cursor()).toEqual({ x: 6, y: 3 });
    terminal.resize(8, 8);
    await terminal.waitFor(() => terminal.screen()[2] === "❯ !中é");
    terminal.stdin.write("\x1b[<0;3;4M\x1b[<0;3;4m");
    await terminal.waitFor(() => cursor().x === 2 && cursor().y === 3);
    terminal.stdin.write("X");
    await terminal.waitFor(() => terminal.screen()[2] === "❯ !中éX");
    expect(terminal.screen()[3]).toBe("  👩AB");
    terminal.stdin.write("\x1b[<4;3;3M\x1b[<32;6;5M\x1b[<0;6;5m");
    testClock.advanceTimersByTime(32);
    await terminal.flush();
    expect(copied.at(-1)).toBe("!中éX👩AB\nnext");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
    testClock.useRealTimers();
  }
});
