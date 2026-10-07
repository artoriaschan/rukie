import { renderComponent } from "../../helpers/render-component";
import { expect, test } from "bun:test";
import { dark, ThemeProvider, ThemedText } from "../../../../src/ink/index.ts";
import {
  SubagentMessage,
  type SubagentView,
} from "../../../../src/tui/components/subagent-message";
import { createTerminal } from "../../helpers/terminal";

for (const columns of [40, 80]) {
  test(`${columns}-column Subagent card keeps five rows with wide multiline descriptions and tool args`, async () => {
    const terminal = createTerminal(columns, 8);
    const row: SubagentView = {
      agentId: "child",
      childSessionId: "child",
      description: "宽字符\n".repeat(20),
      subagentType: "general-purpose",
      status: "running",
      model: "faux/faux-1",
      startedAt: Date.now(),
      durationMs: 0,
      tokens: 2,
      outputLines: ["stale", "one", "two", "🌑宽".repeat(30)],
      toolCalls: [
        { id: "1", name: "read", argsPreview: "old", status: "completed" },
        { id: "2", name: "bash", argsPreview: "宽\n".repeat(60), status: "running" },
      ],
    };
    const app = renderComponent(
      <ThemeProvider>
        <SubagentMessage subagent={row} columns={columns} />
        <ThemedText>after card</ThemedText>
      </ThemeProvider>,
      terminal,
    );
    try {
      await terminal.flush();
      expect(terminal.screen().slice(1, 4)).toEqual([
        expect.stringContaining("✓read · bash"),
        "    │ one",
        "    │ two",
      ]);
      expect(terminal.screen()[4]).toEndWith("…");
      expect(terminal.screen()[5]).toBe("after card");
      expect(terminal.screen().join("\n")).not.toContain("stale");
      const title = terminal.terminal.buffer.active.getLine(0)!.getCell(6)!;
      expect(title.isBold()).toBeTruthy();
      expect(terminal.terminal.buffer.active.getLine(1)!.getCell(7)!.getFgColor()).toBe(
        Number.parseInt(dark.accent.slice(1), 16),
      );
      expect(terminal.terminal.buffer.active.getLine(1)!.getCell(6)!.getFgColor()).toBe(
        Number.parseInt(dark.success.slice(1), 16),
      );
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  });
}

for (const [status, color, glyph] of [
  ["running", dark.warning, "🌑"],
  ["completed", dark.success, "🟢"],
  ["failed", dark.error, "🔴"],
  ["aborted", dark.error, "🔴"],
] as const) {
  test(`${status} status has its public terminal color and hover highlights only glyph and title`, async () => {
    const terminal = createTerminal(100, 8);
    let clicked = 0;
    const row: SubagentView = {
      agentId: "child",
      childSessionId: "child",
      description: "Investigate",
      subagentType: "general-purpose",
      status,
      model: "faux/faux-1",
      startedAt: Date.now(),
      durationMs: 0,
      tokens: 12,
      toolCalls: [],
      outputLines: [],
    };
    const app = renderComponent(
      <ThemeProvider>
        <SubagentMessage subagent={row} columns={100} locale="en" onClick={() => clicked++} />
      </ThemeProvider>,
      terminal,
    );
    try {
      await terminal.flush();
      const text = terminal.screen()[0]!;
      if (status !== "running") expect(text).toContain(glyph);
      const buffer = terminal.terminal.buffer.active;
      expect(
        buffer
          .getLine(0)!
          .getCell(status === "running" ? 3 : 2)!
          .getFgColor(),
      ).toBe(Number.parseInt(color.slice(1), 16));
      const statusX = Bun.stringWidth(text.slice(0, text.lastIndexOf(status)));
      expect(buffer.getLine(0)!.getCell(statusX)!.getFgColor()).toBe(
        Number.parseInt(color.slice(1), 16),
      );
      terminal.stdin.write("\x1b[<35;8;1M");
      await terminal.waitFor(
        () =>
          buffer.getLine(0)!.getCell(6)!.getFgColor() === Number.parseInt(dark.accent.slice(1), 16),
      );
      expect(buffer.getLine(0)!.getCell(statusX)!.getFgColor()).toBe(
        Number.parseInt(color.slice(1), 16),
      );
      terminal.stdin.write("\x1b[<0;8;1M\x1b[<0;8;1m");
      await terminal.waitFor(() => clicked === 1);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  });
}

for (const [previous, active, previousColor, activeColor] of [
  ["write", "bash", "#E5C07B", "#56B6C2"],
  ["bash", "write", "#56B6C2", "#E5C07B"],
] as const) {
  test(`running Subagent colors previous ${previous} and active ${active} by tool category`, async () => {
    const terminal = createTerminal(100, 8);
    const row: SubagentView = {
      agentId: "child",
      childSessionId: "child",
      description: "Investigate",
      subagentType: "general-purpose",
      status: "running",
      model: "faux/faux-1",
      startedAt: Date.now(),
      durationMs: 0,
      tokens: 12,
      outputLines: [],
      toolCalls: [
        {
          id: "previous",
          name: previous,
          argsPreview: "done",
          status: "completed",
          view: { card: "generic", kind: previous === "write" ? "edit" : "execute" },
        },
        {
          id: "active",
          name: active,
          argsPreview: "current",
          status: "running",
          view: { card: "generic", kind: active === "write" ? "edit" : "execute" },
        },
      ],
    };
    const app = renderComponent(
      <ThemeProvider>
        <SubagentMessage subagent={row} columns={100} />
      </ThemeProvider>,
      terminal,
    );
    try {
      await terminal.flush();
      const text = terminal.screen()[1]!;
      const line = terminal.terminal.buffer.active.getLine(1)!;
      const previousX = Bun.stringWidth(text.slice(0, text.indexOf(previous)));
      const activeX = Bun.stringWidth(text.slice(0, text.indexOf(active)));
      expect(line.getCell(previousX)!.getFgColor()).toBe(
        Number.parseInt(previousColor.slice(1), 16),
      );
      expect(line.getCell(activeX)!.getFgColor()).toBe(Number.parseInt(activeColor.slice(1), 16));
      expect(line.getCell(previousX - 1)!.getFgColor()).toBe(
        Number.parseInt(dark.success.slice(1), 16),
      );
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  });
}

test("Agent View glyph opens independently after blank cells and header truncation", async () => {
  const terminal = createTerminal(80, 12);
  let details = 0,
    agentViews = 0;
  const row: SubagentView = {
    agentId: "child",
    childSessionId: "child",
    description: "Reader",
    subagentType: "general-purpose",
    status: "running",
    model: "faux/faux-1",
    startedAt: Date.now(),
    outputLines: ["child output"],
    toolCalls: [],
  };
  const app = renderComponent(
    <SubagentMessage
      subagent={row}
      columns={80}
      locale="en"
      onClick={() => details++}
      onOpenView={() => agentViews++}
    />,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[<0;80;4M\x1b[<0;80;4m");
    await terminal.flush();
    expect(details).toBe(0);
    expect(agentViews).toBe(0);
    const column = terminal.screen()[0]!.indexOf("⤢");
    expect(column).toBeGreaterThan(0);
    terminal.stdin.write(`\x1b[<0;${column + 1};1M\x1b[<0;${column + 1};1m`);
    await terminal.waitFor(() => agentViews === 1);
    expect(details).toBe(0);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
