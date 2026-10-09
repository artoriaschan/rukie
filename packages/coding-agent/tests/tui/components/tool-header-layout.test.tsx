import { renderComponent } from "../helpers/render-component";
import { testClock } from "../helpers/test-clock";
import { expect, test } from "bun:test";
import { Box } from "../../../src/ink/index.ts";
import { ToolCall } from "../../../src/tui/components/tool-call/tool-call";
import { createTerminal } from "../helpers/terminal";

test.each([78, 38])(
  "tool header reserves its arrow within a %s-column container",
  async (width) => {
    testClock.useFakeTimers();
    const terminal = createTerminal(80, 12, (ms) => testClock.advanceTimersByTime(ms));
    const app = renderComponent(
      <Box width={width} flexDirection="column">
        <ToolCall
          name="read"
          args={{ path: "界".repeat(80) }}
          summary="Read"
          status="success"
          startedAt={0}
          endedAt={0}
        />
      </Box>,
      { ...terminal },
    );
    try {
      await terminal.flush();
      const before = terminal.screen()[0]!;
      terminal.stdin.write("\x1b[<35;3;1M");
      await terminal.waitFor(() => terminal.screen()[0]!.includes(" · 0s ▾"));
      expect(terminal.screen()[0]!.slice(0, width)).toContain(" · 0s ▾");
      expect(terminal.screen()[0]!.indexOf(" · 0s")).toBe(before.indexOf(" · 0s"));
      expect(Bun.stringWidth(terminal.screen()[0]!)).toBeLessThanOrEqual(width);
      terminal.stdin.write(`\x1b[<0;${width};1M\x1b[<0;${width};1m`);
      await terminal.waitFor(() => terminal.screen()[0]!.includes(" · 0s ▴"));
      expect(terminal.screen()[0]!).toContain(" · 0s ▴");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
      testClock.useRealTimers();
    }
  },
);

test.each([false, true])(
  "MCP card uses readable identity with restored views: %s",
  async (declared) => {
    testClock.useFakeTimers();
    const terminal = createTerminal(60, 14, (ms) => testClock.advanceTimersByTime(ms));
    const app = renderComponent(
      <ToolCall
        name="mcp__local__echo"
        args={{ text: "request" }}
        summary="mcp__local__echo"
        status="success"
        callView={
          declared
            ? {
                card: "generic",
                kind: "other",
                server: "local",
                tool: "echo",
                rawInput: { text: "request" },
              }
            : undefined
        }
        resultView={
          declared
            ? { card: "generic", kind: "other", text: "one\ntwo\nthree\nfour\nfive" }
            : undefined
        }
        result={"one\ntwo\nthree\nfour\nfive"}
      />,
      { ...terminal },
    );
    try {
      await terminal.flush();
      expect(terminal.screen()[0]).toContain("local › echo");
      expect(terminal.screen()[0]).not.toContain("mcp__");
      expect(terminal.screen()[0]).not.toContain("Mcp__");
      expect(terminal.screen().join("\n")).toContain("⎿ one");
      expect(terminal.screen().join("\n")).not.toContain("five");
      terminal.stdin.write("\x1b[<0;5;1M\x1b[<0;5;1m");
      await terminal.waitFor(() => terminal.screen().join("\n").includes("five"));
      terminal.resize(38, 14);
      await terminal.waitFor(() => terminal.screen()[0]!.includes("local › echo"));
      expect(terminal.screen()[0]).not.toContain("mcp__");
      app.rerender(
        <ToolCall
          name="mcp__local__echo"
          summary="mcp__local__echo"
          status="error"
          error="MCP request failed"
        />,
      );
      await terminal.waitFor(() => terminal.screen().join("\n").includes("MCP request failed"));
      expect(terminal.screen()[0]).toContain("✗ local › echo");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
      testClock.useRealTimers();
    }
  },
);
