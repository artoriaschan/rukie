import { expect, test } from "bun:test";
import { figures } from "@neant/tui";
import { start } from "../helpers/app";

test("streamed and completed replies keep the marker beside the first word and user blocks retain their style", async () => {
  const app = await start(["prompt 中\n  code"], { columns: 40 });
  const firstLine = `${figures.assistant} ${"x".repeat(38)}`;
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(" ");
    await app.waitFor(() => app.screen().some((line) => line.includes("↓ 1")));
    expect(app.screen()).not.toContain(figures.assistant);
    app.calls[0]!.delta("\n\n" + "x".repeat(39) + "\n\nnext");
    await app.waitFor(() => app.screen().includes(firstLine));
    const reply = app.screen().indexOf(firstLine);
    expect(app.screen().slice(reply, reply + 4)).toEqual([firstLine, "  x", "", "  next"]);
    const prompt = app.screen().indexOf("❯ prompt 中");
    expect(prompt).toBeGreaterThanOrEqual(0);
    expect(app.screen()[prompt + 1]).toBe("    code");
    const cell = (x: number, y: number) => app.terminal.buffer.active.getLine(y)!.getCell(x)!;
    expect(cell(2, prompt).isBold()).toBeTruthy();
    expect(cell(2, prompt).getFgColor()).toBe(0x6b5221);
    for (const y of [prompt, prompt + 1]) {
      expect(cell(0, y).getBgColor()).toBe(0xd8dadd);
      expect(cell(39, y).getBgColor()).toBe(0xd8dadd);
    }
    expect(cell(0, reply).getFgColor()).toBe(0x7da1de);
    expect(cell(0, reply).isBgDefault()).toBe(true);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen()).toContain(firstLine);
    expect(app.screen()).not.toContain(figures.assistant);
    app.resize(60, 24);
    await app.waitFor(() => app.screen().includes(`${figures.assistant} ${"x".repeat(39)}`));
    const resizedPrompt = app.screen().indexOf("❯ prompt 中");
    expect(resizedPrompt).toBeGreaterThanOrEqual(0);
    expect(cell(59, resizedPrompt).getBgColor()).toBe(0xd8dadd);
    expect(cell(59, resizedPrompt + 2).isBgDefault()).toBe(true);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});
