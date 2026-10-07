import { expect, spyOn, test } from "bun:test";
import { useState } from "react";
import { renderSync, AlternateScreen, Box, Text, useInput } from "../../src/ink/index.ts";
import { createTerminal } from "../tui/helpers/terminal";

test("alternate exit clears its hover after commit and preserves another root", async () => {
  const a = createTerminal(20, 6);
  const b = createTerminal(20, 6);
  const errors: unknown[][] = [];
  const error = spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
  function Screen({
    label,
    inline = false,
    mode,
  }: {
    label: string;
    inline?: boolean;
    mode?: boolean;
  }) {
    const [alternate, setAlternate] = useState(!inline);
    const [hovered, setHovered] = useState(false);
    useInput((input) => {
      if (input === "a") setAlternate(true);
      if (input === "m") setAlternate(false);
    });
    const content = (
      <Box onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <Text>
          {label}:{hovered ? "hover" : "idle"}
        </Text>
      </Box>
    );
    return (mode ?? alternate) ? <AlternateScreen>{content}</AlternateScreen> : content;
  }
  const options = { exitOnCtrlC: false, patchConsole: false, terminalImages: false };
  const first = renderSync(<Screen label="alpha" inline />, {
    ...options,
    stdin: a.stdin,
    stdout: a.stdout,
    stderr: a.stdout,
  });
  const second = renderSync(<Screen label="beta" />, {
    ...options,
    stdin: b.stdin,
    stdout: b.stdout,
    stderr: b.stdout,
  });
  try {
    await a.waitFor(() => a.screen().join("\n").includes("alpha:idle"));
    await b.waitFor(() => b.screen().join("\n").includes("beta:idle"));
    b.stdin.write("\x1b[<35;2;1M");
    await b.waitFor(() => b.screen().join("\n").includes("beta:hover"));
    a.stdin.write("a");
    await a.waitFor(
      () =>
        a.terminal.buffer.active.type === "alternate" &&
        a.screen().join("\n").includes("alpha:idle"),
    );
    expect(a.screen().filter((line) => line.includes("alpha:idle"))).toHaveLength(1);
    a.stdin.write("\x1b[<35;2;1M");
    await a.waitFor(() => a.screen().join("\n").includes("alpha:hover"));
    a.stdin.write("m");
    await a.waitFor(
      () =>
        a.terminal.buffer.active.type === "normal" && a.screen().join("\n").includes("alpha:idle"),
    );
    expect(a.screen().filter((line) => line.includes("alpha:idle"))).toHaveLength(1);
    expect(b.screen().join("\n")).toContain("beta:hover");
    a.stdin.write("a");
    await a.waitFor(() => a.terminal.buffer.active.type === "alternate");
    a.stdin.write("\x1b[<35;2;1M");
    await a.waitFor(() => a.screen().join("\n").includes("alpha:hover"));
    first.rerender(<Screen label="alpha" mode={false} />);
    first.rerender(<Screen label="alpha" mode={true} />);
    await a.flush();
    expect(a.terminal.buffer.active.type).toBe("alternate");
    expect(a.screen().join("\n")).toContain("alpha:hover");
    expect(errors.flat().some((value) => String(value).includes("useInsertionEffect"))).toBe(false);
    expect(a.stdin.isRaw).toBe(true);
    expect(b.stdin.isRaw).toBe(true);
  } finally {
    first.unmount();
    second.unmount();
    await Promise.all([first.waitUntilExit(), second.waitUntilExit()]);
    first.cleanup();
    second.cleanup();
    error.mockRestore();
    a.dispose();
    b.dispose();
  }
});
