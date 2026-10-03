import { expect, test } from "bun:test";
import { render } from "@neant/tui";
import { createRef } from "react";
import type { ScrollHandle } from "@neant/tui";
import { PermissionDialog } from "../../../src/components";
import { createTerminal } from "../../helpers/terminal";

test("permission panel groups a tool heading, command and question above its focused choice", async () => {
  const terminal = createTerminal(80, 13);
  const app = render(
    <PermissionDialog
      toolName="bash"
      args={{ command: "printf hello" }}
      selected={1}
      maxHeight={12}
    />,
    terminal,
  );
  try {
    await terminal.flush();
    const lines = terminal.screen();
    expect(lines[0]).toMatch(/^  ─ 等待审批 · bash ─+$/);
    const buffer = terminal.terminal.buffer.active;
    const divider = buffer.getLine(buffer.viewportY)!;
    expect(divider.getCell(77)!.getChars()).toBe("─");
    expect(divider.getCell(2)!.getFgColor()).toBe(0xabc2ec);
    expect(lines).toContain("    printf hello");
    expect(lines.join("\n")).not.toContain('"command"');
    expect(lines).toContain("  要允许这次操作吗？");
    expect(lines).toContain("    1. 允许（仅本次）");
    const selected = lines.indexOf("  ❯ 2. 本 session 内一直允许这个工具");
    expect(selected).toBeGreaterThan(lines.indexOf("  要允许这次操作吗？"));
    expect(lines[selected - 1]).toBe("");
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
    await terminal.flush();
    const screen = () => terminal.screen().join("\n");
    expect(screen()).toContain("等待审批 · bash");
    expect(screen()).toContain("deploy --target production");
    expect(screen()).toContain('"timeout": 30');
    expect(screen()).toContain("需要确认部署目标");
    expect(screen()).toContain("要允许这次操作吗？");
    expect(screen()).toContain("❯ 2. 拒绝");
    expect(screen()).not.toContain("一直允许");
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
