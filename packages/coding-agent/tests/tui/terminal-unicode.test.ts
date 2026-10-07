import { expect, test } from "bun:test";
import { createTerminal } from "./helpers/terminal";

test("terminal oracle keeps wide grapheme owners and tails within one row", async () => {
  const app = createTerminal(12, 3);
  try {
    app.stdout.write("界🧑‍💻e\u0301🌖X");
    await app.flush();
    const line = app.terminal.buffer.active.getLine(0)!;
    expect(line.getCell(0)!.getChars()).toBe("界");
    expect(line.getCell(0)!.getWidth()).toBe(2);
    expect(line.getCell(1)!.getWidth()).toBe(0);
    expect(line.getCell(2)!.getChars()).toBe("🧑‍💻");
    expect(line.getCell(2)!.getWidth()).toBe(2);
    expect(line.getCell(3)!.getWidth()).toBe(0);
    expect(line.getCell(4)!.getChars()).toBe("e\u0301");
    expect(line.getCell(5)!.getChars()).toBe("🌖");
    expect(line.getCell(5)!.getWidth()).toBe(2);
    expect(line.getCell(6)!.getWidth()).toBe(0);
    expect(line.getCell(7)!.getChars()).toBe("X");
    expect(app.screen()[1]).toBe("");
  } finally {
    app.dispose();
  }
});
