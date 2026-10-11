import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PermissionDock } from "../../src/components/conversation-dock";
import { UiLocaleProvider } from "../../src/lib/i18n";
import "../../src/theme.css";

test("tool permission dock uses default Tool Approval details and unclipped actions at narrow widths", async () => {
  await page.viewport(1280, 900);
  const onReply = vi.fn();
  const identity = {
    epoch: "focused-approval",
    requestId: "focused-approval",
    taskId: 1,
    conversationId: 1,
  };
  const screen = await render(
    <UiLocaleProvider locale="zh">
      <div className="mx-auto w-full max-w-3xl px-5">
        <PermissionDock
          requests={[
            {
              identity,
              toolName: "bash",
              toolCallId: "approval-call",
              args: { command: "printf verified # " + "long/command/path ".repeat(100) },
              mode: "ask",
              sessionAllow: { kind: "tool", rule: "bash" },
            },
          ]}
          connected
          pending={null}
          shortcutsEnabled
          onReply={onReply}
        />
      </div>
    </UiLocaleProvider>,
  );
  const allow = screen.getByRole("button", { name: "允许 ↵", exact: true });
  const verifyFocusBounds = (button: Element) => {
    expect(button.matches(":focus-visible")).toBe(true);
    const style = getComputedStyle(button);
    expect(style.boxShadow).not.toBe("none");
    const reach = 4;
    const bounds = button.getBoundingClientRect();
    for (let parent = button.parentElement; parent; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.overflowX === "hidden" || parentStyle.clipPath !== "none") {
        const clip = parent.getBoundingClientRect();
        expect(bounds.left - reach, "focus outline left edge").toBeGreaterThanOrEqual(clip.left);
        expect(bounds.right + reach, "focus outline right edge").toBeLessThanOrEqual(clip.right);
      }
      if (parentStyle.overflowY === "hidden" || parentStyle.clipPath !== "none") {
        const clip = parent.getBoundingClientRect();
        expect(bounds.bottom + reach, "focus outline bottom edge").toBeLessThanOrEqual(clip.bottom);
      }
    }
  };
  try {
    await expect.element(allow).toHaveFocus();
    const details = screen.getByRole("button", { name: "查看详情", exact: true });
    await expect.element(details).toHaveAttribute("aria-expanded", "false");
    expect(allow.element().closest("[data-state=pending]")).not.toBeNull();
    verifyFocusBounds(allow.element());
    await details.click();
    await expect.element(details).toHaveAttribute("aria-expanded", "true");
    await allow.click();
    await userEvent.keyboard("{Tab}{Shift>}{Tab}{/Shift}");
    await expect.element(allow).toHaveFocus();
    verifyFocusBounds(allow.element());
    await page.viewport(420, 700);
    verifyFocusBounds(allow.element());
    await userEvent.keyboard("{Tab}");
    const session = screen.getByRole("button", { name: "本会话内允许 A", exact: true });
    await expect.element(session).toHaveFocus();
    verifyFocusBounds(session.element());
    await userEvent.keyboard("{Tab}");
    const deny = screen.getByRole("button", { name: "拒绝 Esc", exact: true });
    await expect.element(deny).toHaveFocus();
    verifyFocusBounds(deny.element());
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    await userEvent.keyboard("{Enter}");
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ identity }), "deny");
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});
