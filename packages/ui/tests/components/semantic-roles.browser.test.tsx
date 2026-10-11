import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { ToolApproval } from "../../src/components/agents/tool-approval";
import { ApprovalCard } from "../../src/components/agents/approval-card";
import { Button } from "../../src/components/motion/button";
import { Input } from "../../src/components/motion/input";
import { UiLocaleProvider } from "../../src/lib/i18n";
import "../../src/theme.css";

for (const theme of ["light", "dark"] as const) {
  test(`${theme} waiting confirmation differs from completed success and requested changes`, async () => {
    const screen = await render(
      <UiLocaleProvider locale="en">
        <div className={theme}>
          <ToolApproval tool="bash" status="pending" />
          <ToolApproval tool="read" status="approved" />
          <ApprovalCard title="Question" status="pending" />
          <ApprovalCard title="Review" status="changes-requested" />
          <Input label="Setting" placeholder="Enter a value" />
        </div>
      </UiLocaleProvider>,
    );
    try {
      const waiting = screen.getByText("Approval required").element();
      const question = screen.getByText("Input required").element();
      const approved = screen.getByText("Approved", { exact: true }).element();
      const changes = screen.getByText("Changes requested", { exact: true }).elements()[0];
      if (!changes) throw new Error("Missing requested-changes status");
      expect(getComputedStyle(waiting).color).toBe(
        theme === "light" ? "rgb(17, 99, 41)" : "rgb(126, 231, 135)",
      );
      expect(getComputedStyle(question).color).toBe(getComputedStyle(waiting).color);
      expect(getComputedStyle(waiting).backgroundColor).toBe(
        theme === "light" ? "rgb(218, 251, 225)" : "rgb(3, 58, 22)",
      );
      expect(getComputedStyle(approved).color).not.toBe(getComputedStyle(waiting).color);
      expect(getComputedStyle(changes).color).toBe(
        theme === "light" ? "rgb(154, 103, 0)" : "rgb(210, 153, 34)",
      );
      const input = screen.getByRole("textbox", { name: "Setting" });
      await input.click();
      expect(input.element().parentElement?.classList.contains("bg-input-focused")).toBe(true);
      expect(getComputedStyle(input.element(), "::placeholder").color).toBe(
        theme === "light" ? "rgb(101, 109, 118)" : "rgb(132, 141, 151)",
      );
    } finally {
      await screen.unmount();
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} field hover preserves focus, error and disabled borders`, async () => {
    const screen = await render(
      <div className={theme}>
        <Input label="Idle field" />
        <Input label="Invalid field" error="Invalid value" />
        <Input label="Disabled field" disabled />
        <Button variant="ghost">Ghost action</Button>
        <Button variant="outline">Outline action</Button>
      </div>,
    );
    try {
      const idle = screen.getByRole("textbox", { name: "Idle field" });
      const invalid = screen.getByRole("textbox", { name: "Invalid field" });
      const disabled = screen.getByRole("textbox", { name: "Disabled field" });
      const idleField = idle.element().parentElement;
      const invalidField = invalid.element().parentElement;
      const disabledField = disabled.element().parentElement;
      if (!idleField || !invalidField || !disabledField) throw new Error("Missing input field");
      // Distinct role values make precedence observable even when a palette aliases them.
      for (const field of [idleField, invalidField, disabledField]) {
        field.style.setProperty("--input-border", "rgb(80, 90, 100)");
        field.style.setProperty("--input-border-hover", "rgb(100, 110, 120)");
        field.style.setProperty("--input-border-focused", "rgb(20, 80, 140)");
        field.style.setProperty("--destructive", "rgb(180, 30, 40)");
      }
      await expect.poll(() => getComputedStyle(idleField).borderTopColor).toBe("rgb(80, 90, 100)");
      await idle.hover();
      await expect
        .poll(() => getComputedStyle(idleField).borderTopColor)
        .toBe("rgb(100, 110, 120)");
      await idle.click();
      await expect.poll(() => getComputedStyle(idleField).borderTopColor).toBe("rgb(20, 80, 140)");
      await screen.getByRole("button", { name: "Ghost action" }).hover();
      await idle.hover();
      expect(getComputedStyle(idleField).borderTopColor).toBe("rgb(20, 80, 140)");
      await invalid.hover();
      await expect
        .poll(() => getComputedStyle(invalidField).borderTopColor)
        .toBe("rgb(180, 30, 40)");
      await invalid.click();
      expect(getComputedStyle(invalidField).borderTopColor).toBe("rgb(180, 30, 40)");
      await disabled.hover();
      await expect
        .poll(() => getComputedStyle(disabledField).borderTopColor)
        .toBe("rgb(80, 90, 100)");
      for (const name of ["Ghost action", "Outline action"]) {
        const action = screen.getByRole("button", { name });
        action.element().style.setProperty("--hover", "rgb(220, 225, 230)");
        await action.hover();
        await expect
          .poll(() => getComputedStyle(action.element()).backgroundColor)
          .toBe("rgb(220, 225, 230)");
      }
    } finally {
      await screen.unmount();
    }
  });
}
