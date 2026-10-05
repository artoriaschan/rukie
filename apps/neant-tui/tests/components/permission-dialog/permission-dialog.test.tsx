import { expect, test } from "bun:test";
import { Box, ThemedText, render } from "@neant/tui";
import { createRef, useState } from "react";
import { useInput } from "@neant/tui";
import type { ScrollHandle } from "@neant/tui";
import { PermissionDialog } from "../../../src/components";
import { createTerminal } from "../../helpers/terminal";

test("permission panel groups a tool heading, command and question above its focused choice", async () => {
  const terminal = createTerminal(80, 13);
  const app = render(
    <Box flexDirection="column">
      <PermissionDialog
        toolName="bash"
        sessionAllow={{ kind: "command", rule: "bash(printf hello)" }}
        args={{ command: "printf hello" }}
        selected={1}
        maxHeight={12}
      />
      <ThemedText>next-field</ThemedText>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    const lines = terminal.screen();
    expect(lines[0]).toMatch(/^  ─+ ⏳ 等待审批 · bash ─+$/);
    const [, left, right] = /^  (─+) ⏳ 等待审批 · bash (─+)$/.exec(lines[0]!)!;
    expect(Math.abs(left!.length - right!.length)).toBeLessThanOrEqual(1);
    const buffer = terminal.terminal.buffer.active;
    const divider = buffer.getLine(buffer.viewportY)!;
    expect(divider.getCell(77)!.getChars()).toBe("─");
    expect(divider.getCell(2)!.getFgColor()).toBe(0xabc2ec);
    expect(lines).toContain("    printf hello");
    expect(lines.join("\n")).not.toContain('"command"');
    expect(lines).toContain("  要允许这次操作吗？");
    expect(lines).toContain("    1. 允许（仅本次）");
    const selected = lines.indexOf("  ❯ 2. 本 session 允许此命令");
    expect(selected).toBeGreaterThan(lines.indexOf("  要允许这次操作吗？"));
    expect(lines[lines.indexOf("    1. 允许（仅本次）") - 1]).toBe("");
    expect(lines).toContain("    3. 拒绝");
    const focused = buffer.getLine(buffer.viewportY + selected)!;
    for (const column of [2, 4, 7]) {
      expect(focused.getCell(column)!.getFgColor()).toBe(0x7da1de);
      expect(focused.getCell(column)!.isBold()).toBeTruthy();
    }
    const unfocused = buffer
      .getLine(buffer.viewportY + lines.indexOf("    1. 允许（仅本次）"))!
      .getCell(4)!;
    expect(unfocused.getFgColor()).toBe(0xe8e6e0);
    expect(unfocused.isBold()).toBeFalsy();
    const hint = lines.indexOf("  ↑↓选择 · Enter确认 · Esc拒绝 · Tab详情");
    expect(hint).toBeGreaterThan(selected);
    expect(lines.indexOf("next-field")).toBe(hint + 2);
    expect(lines[hint + 1]).toBe("");
    expect(
      buffer
        .getLine(buffer.viewportY + hint)!
        .getCell(2)!
        .getFgColor(),
    ).toBe(0x5e6673);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test.each(["ask", "auto-review"] as const)(
  "%s: short approval fits its content and option rows stay fixed when choosing",
  async (mode) => {
    const terminal = createTerminal(80, 20);
    function Panel() {
      const [selected, select] = useState(0);
      const count = mode === "ask" ? 3 : 2;
      useInput((event) => {
        if (event.type === "key" && event.key.name === "down")
          select((index) => (index + 1) % count);
      });
      return (
        <PermissionDialog
          toolName="bash"
          sessionAllow={{ kind: "command", rule: "bash(printf hello)" }}
          args={{ command: "printf hello" }}
          mode={mode}
          selected={selected}
          maxHeight={16}
        />
      );
    }
    const app = render(<Panel />, terminal);
    const optionRows = () =>
      terminal.screen().flatMap((line, row) => (/[1-3]\. /.test(line) ? [row] : []));
    try {
      await terminal.flush();
      const baseline = optionRows();
      terminal.stdin.write("\x1b[B");
      await terminal.waitFor(() => terminal.screen().some((line) => line.includes("❯ 2.")));
      expect(optionRows()).toEqual(baseline);
      terminal.stdin.write("\x1b[B");
      await terminal.waitFor(() =>
        terminal.screen().some((line) => line.includes(mode === "ask" ? "❯ 3." : "❯ 1.")),
      );
      expect(optionRows()).toEqual(baseline);
      const lines = terminal.screen();
      expect(
        lines.findIndex((line) => line.includes("要允许这次操作吗？")) -
          lines.findIndex((line) => line.includes("printf hello")),
      ).toBe(1);
      expect(lines.findIndex((line) => line.includes("↑↓选择"))).toBeLessThan(10);
      expect(lines[0]).toMatch(/^  ─+ ⏳ 等待审批 · bash ─+$/);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  },
);

test("review reasons wrap and scroll with details while the two decisions stay pinned", async () => {
  const terminal = createTerminal(40, 13);
  const details = createRef<ScrollHandle>();
  const reason = [
    "需要确认部署目标",
    ...Array.from({ length: 15 }, (_, i) => `审查原因第${i}行`),
    "reason-tail",
  ].join("\n");
  const app = render(
    <PermissionDialog
      toolName="bash"
      sessionAllow={{ kind: "command", rule: "bash(printf hello)" }}
      args={{ command: "deploy --target production", timeout: 30 }}
      reason={reason}
      mode="auto-review"
      selected={1}
      maxHeight={12}
      scrollRef={details}
    />,
    terminal,
  );
  try {
    await terminal.waitFor(() => terminal.screen().join("\n").includes("需要确认部署目标"));
    const screen = () => terminal.screen().join("\n");
    expect(screen()).toContain("等待审批 · bash");
    expect(screen()).toContain("deploy --target production");
    expect(screen()).toContain('"timeout": 30');
    expect(screen()).toContain("需要确认部署目标");
    expect(screen()).toContain("要允许这次操作吗？");
    expect(screen()).toContain("❯ 2. 拒绝");
    expect(screen()).not.toContain("本 session");
    expect(screen()).not.toContain("reason-tail");
    expect(screen()).toContain("↑↓选择 Enter确认 Esc拒绝 Tab详情");
    details.current!.scrollToBottom();
    await terminal.waitFor(() => screen().includes("reason-tail"));
    expect(screen()).toContain("reason-tail");
    expect(screen()).toContain("❯ 2. 拒绝");
    expect(screen()).toContain("要允许这次操作吗？");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test.each([
  ["command", "zh", "本 session 允许此命令"],
  ["directory", "zh", "本 session 允许此目录"],
  ["tool", "zh", "本 session 允许此工具"],
  ["domain", "zh", "本 session 允许此域名"],
  ["command", "en", "Allow this command for this session"],
  ["directory", "en", "Allow this directory for this session"],
  ["tool", "en", "Allow this tool for this session"],
  ["domain", "en", "Allow this domain for this session"],
] as const)("session %s label in %s", async (kind, locale, label) => {
  const terminal = createTerminal(80, 13);
  const app = render(
    <PermissionDialog
      toolName="example"
      args={{}}
      sessionAllow={{ kind, rule: "example" }}
      locale={locale}
      selected={1}
      maxHeight={12}
    />,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen().join("\n")).toContain(label);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test.each(["command", "directory", "tool"] as const)(
  "auto-review hides the %s session choice",
  async (kind) => {
    const terminal = createTerminal(80, 13);
    const app = render(
      <PermissionDialog
        toolName="tool"
        args={{}}
        sessionAllow={{ kind, rule: "tool" }}
        mode="auto-review"
        selected={1}
        maxHeight={12}
      />,
      terminal,
    );
    try {
      await terminal.flush();
      expect(terminal.screen().join("\n")).not.toContain("本 session");
      expect(terminal.screen().join("\n")).toContain("2. 拒绝");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  },
);
