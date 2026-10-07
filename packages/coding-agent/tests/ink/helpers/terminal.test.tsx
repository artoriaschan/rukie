import { expect, test } from "bun:test";
import chalk from "chalk";
import { createTerminal as createAppTerminal } from "../../tui/helpers/terminal";
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

test("renderer and app terminals share color ownership until the final root is disposed", async () => {
  const previous = chalk.level;
  chalk.level = 0;
  const renderer = createTerminal(12, 3);
  const frontend = createAppTerminal(12, 3);
  let rendererDisposed = false;
  let frontendDisposed = false;
  const app = renderSync(
    <AlternateScreen>
      <Text color="ansi:red">first</Text>
    </AlternateScreen>,
    frontend,
  );
  try {
    await frontend.flush();
    renderer.dispose();
    rendererDisposed = true;
    expect(chalk).toHaveProperty("level", 3);
    app.rerender(
      <AlternateScreen>
        <Text color="ansi:blue">second</Text>
      </AlternateScreen>,
    );
    await frontend.waitFor(() => frontend.screen()[0] === "second");
    expect(frontend.terminal.buffer.active.getLine(0)!.getCell(0)!.isFgDefault()).toBe(false);
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    frontend.dispose();
    frontendDisposed = true;
    expect(chalk).toHaveProperty("level", 0);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    if (!rendererDisposed) renderer.dispose();
    if (!frontendDisposed) frontend.dispose();
    chalk.level = previous;
  }
});

for (const [name, create] of [
  ["renderer", createTerminal],
  ["app", createAppTerminal],
] as const) {
  test(`${name} terminal flush rejects a disposed output without waiting on frontend time`, async () => {
    const clock = FakeTimers.install({ now: 1000, toFake: ["Date", "setTimeout", "clearTimeout"] });
    const terminal = create(12, 3, (ms) => clock.tick(ms));
    try {
      terminal.stdout.destroy();
      await expect(terminal.flush()).rejects.toThrow();
      expect(Date.now()).toBe(1000);
    } finally {
      terminal.dispose();
      clock.uninstall();
    }
  });
}
