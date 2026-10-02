import { expect, test } from "bun:test";
import { dark, render, ThemeProvider } from "@neant/tui";
import { Logo, mergeColoredCells, renderBigText } from "../../../src/components/logo";
import { createTerminal } from "../../helpers/terminal";

test("NEANT is five rows with the horizontal gradient reaching both colored edge columns", () => {
  const rows = renderBigText("NEANT", "#000000", "#ffffff");
  expect(rows).toHaveLength(5);
  expect(rows.map((row) => row.length)).toEqual([34, 34, 34, 34, 34]);
  expect(rows[0]![0]).toEqual({ ch: "█", color: "#000000" });
  expect(rows[0]![33]).toEqual({ ch: "▀", color: "#ffffff" });
  expect(rows[0]![16]).toEqual({ ch: "▀", color: "#7c7c7c" });
  expect(rows[4]![16]).toEqual({ ch: " ", color: "#7c7c7c" });
  expect(
    rows[4]!
      .slice(28)
      .map((cell) => cell.ch)
      .join(""),
  ).toBe("  ██  ");
});

test("adjacent cells of the same color become one text segment without losing spaces", () => {
  expect(
    mergeColoredCells([
      { ch: "█", color: "#112233" },
      { ch: " ", color: "#112233" },
      { ch: "▀", color: "#112233" },
      { ch: "▄", color: "#445566" },
      { ch: "█", color: "#445566" },
      { ch: "█", color: "#112233" },
    ]),
  ).toEqual([
    { text: "█ ▀", color: "#112233" },
    { text: "▄█", color: "#445566" },
    { text: "█", color: "#112233" },
  ]);
});

test("logo paints theme gradient cells above subtle model and cwd metadata", async () => {
  const terminal = createTerminal(80, 8);
  const app = render(
    <ThemeProvider theme={{ ...dark, logoFrom: "#112233", logoTo: "#445566", subtle: "#778899" }}>
      <Logo model="local/model" cwd="/project" />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("██  ██ ██▀▀▀▀  ▄▀▀▄  ██  ██ ▀▀██▀▀");
    expect(terminal.screen()[5]).toBe("local/model · /project");
    const buffer = terminal.terminal.buffer.active;
    expect(buffer.getLine(buffer.viewportY)!.getCell(0)!.getFgColor()).toBe(0x112233);
    expect(buffer.getLine(buffer.viewportY)!.getCell(33)!.getFgColor()).toBe(0x445566);
    expect(
      buffer
        .getLine(buffer.viewportY + 5)!
        .getCell(0)!
        .getFgColor(),
    ).toBe(0x778899);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
