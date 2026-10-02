import { expect, test } from "bun:test";
import { render } from "@neant/tui";
import { PermissionDialog } from "../../../src/components";
import { createTerminal } from "../../helpers/terminal";

test("permission dialog has a full-width divider and an accent bold focused choice", async () => {
  const terminal = createTerminal(80, 8);
  const app = render(
    <PermissionDialog toolName="bash" args={{ command: "printf hello" }} selected={1} />,
    terminal,
  );
  try {
    await terminal.flush();
    const lines = terminal.screen();
    expect(lines[0]).toMatch(/^─ 权限确认 ─+$/);
    const buffer = terminal.terminal.buffer.active;
    const divider = buffer.getLine(buffer.viewportY)!;
    expect(divider.getCell(79)!.getChars()).toBe("─");
    expect(divider.getCell(0)!.getFgColor()).toBe(0xabc2ec);
    expect(lines[1]).toBe('bash {"command":"printf hello"}');
    expect(lines[2]).toBe("  1. 允许一次");
    expect(lines[3]).toBe("❯ 2. 本 session 内一直允许这个工具");
    expect(lines[4]).toBe("  3. 拒绝");
    const focused = buffer.getLine(buffer.viewportY + 3)!;
    for (const column of [0, 2, 5]) {
      expect(focused.getCell(column)!.getFgColor()).toBe(0x7da1de);
      expect(focused.getCell(column)!.isBold()).toBeTruthy();
    }
    const unfocused = buffer.getLine(buffer.viewportY + 2)!.getCell(2)!;
    expect(unfocused.getFgColor()).toBe(0xe8e6e0);
    expect(unfocused.isBold()).toBeFalsy();
    expect(lines[5]).toBe("方向键或 1–3 选择 · Enter 确认 · Esc 拒绝");
    expect(
      buffer
        .getLine(buffer.viewportY + 5)!
        .getCell(0)!
        .getFgColor(),
    ).toBe(0x5e6673);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
