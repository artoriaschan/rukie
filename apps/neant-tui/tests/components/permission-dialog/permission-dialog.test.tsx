import { expect, test } from "bun:test";
import { render } from "@neant/tui";
import { PermissionDialog } from "../../../src/components";
import { createTerminal } from "../../helpers/terminal";

test("permission dialog has a full-width divider and an accent bold focused choice", async () => {
  const terminal = createTerminal(80, 10);
  const app = render(
    <PermissionDialog
      toolName="bash"
      args={{ command: "printf hello" }}
      selected={1}
      maxHeight={9}
    />,
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
    expect(lines.slice(1, 5)).toEqual(["bash", "{", '  "command": "printf hello"', "}"]);
    expect(lines[5]).toBe("  1. 允许一次");
    expect(lines[6]).toBe("❯ 2. 本 session 内一直允许这个工具");
    expect(lines[7]).toBe("  3. 拒绝");
    const focused = buffer.getLine(buffer.viewportY + 6)!;
    for (const column of [0, 2, 5]) {
      expect(focused.getCell(column)!.getFgColor()).toBe(0x7da1de);
      expect(focused.getCell(column)!.isBold()).toBeTruthy();
    }
    const unfocused = buffer.getLine(buffer.viewportY + 5)!.getCell(2)!;
    expect(unfocused.getFgColor()).toBe(0xe8e6e0);
    expect(unfocused.isBold()).toBeFalsy();
    expect(lines[8]).toBe("↑↓选择 · Enter确认 · Esc拒绝 · Tab详情");
    expect(
      buffer
        .getLine(buffer.viewportY + 8)!
        .getCell(0)!
        .getFgColor(),
    ).toBe(0x5e6673);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
