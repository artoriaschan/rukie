import { expect, test } from "bun:test";
import FakeTimers from "@sinonjs/fake-timers";
import { AlternateScreen, Text, renderSync } from "../../../src/ink";
import { createTerminal } from "./terminal";

test("injected terminal preserves complete wide graphemes while flush keeps frontend time frozen", async () => {
  const clock = FakeTimers.install({ now: 1000, toFake: ["Date", "setTimeout", "clearTimeout"] });
  const terminal = createTerminal(12, 3, (ms) => clock.tick(ms));
  const app = renderSync(
    <AlternateScreen>
      <Text>{"界🧑‍💻e\u0301🌖X"}</Text>
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    const line = terminal.terminal.buffer.active.getLine(0)!;
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
    expect(terminal.screen()[1]).toBe("");
    expect(Date.now()).toBe(1000);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
    clock.uninstall();
  }
});
