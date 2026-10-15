import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { PlanReviewDock } from "../../src/components/plan-review-dock";
import { UiLocaleProvider } from "../../src/lib/i18n";
import "../../src/theme.css";
const request = {
  kind: "plan_review" as const,
  identity: { epoch: "review", conversationId: 1, requestId: "review", taskId: 1 },
  toolCallId: "call",
  plan: "# Migration **plan**",
};

test("C43 plan review matches source number circles, inline descriptions and custom row", async () => {
  await page.viewport(1280, 900);
  const screen = await render(
    <UiLocaleProvider locale="en">
      <div className="mx-auto w-full max-w-[800px] px-6">
        <PlanReviewDock
          request={request}
          connected
          pending={null}
          shortcutsEnabled
          onReply={() => {}}
        />
      </div>
    </UiLocaleProvider>,
  );
  try {
    const region = screen.getByRole("region", { name: "Plan review required" }).element();
    const approve = screen.getByRole("button", { name: /Approve and execute/ }).element();
    const number = approve.querySelector("span[aria-hidden=true]")!;
    expect(region.getBoundingClientRect().width).toBe(752);
    expect(getComputedStyle(region).borderRadius).toBe("16px");
    expect(approve.getBoundingClientRect().height).toBe(48);
    expect(number.getBoundingClientRect().width).toBe(28);
    expect(number.getBoundingClientRect().height).toBe(28);
    expect(parseFloat(getComputedStyle(number).borderRadius)).toBeGreaterThanOrEqual(14);
    const label = screen
      .getByText("Approve and execute", { exact: true })
      .element()
      .getBoundingClientRect();
    const description = screen
      .getByText("Exit plan mode and use the current permission mode.")
      .element()
      .getBoundingClientRect();
    expect(description.left - label.right).toBe(8);
    expect(Math.abs(label.top - description.top)).toBeLessThan(3);
    expect(
      screen
        .getByRole("textbox")
        .element()
        .closest("[data-interaction-custom]")!
        .getBoundingClientRect().height,
    ).toBe(52);
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle("dark", dark);
      expect(getComputedStyle(region).backgroundColor).toBe(
        dark ? "rgb(43, 43, 43)" : "rgb(255, 255, 255)",
      );
      await page.viewport(420, 700);
      expect(region.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    }
  } finally {
    await screen.unmount();
    document.documentElement.classList.remove("dark");
    await page.viewport(1280, 900);
  }
});

test.each(["approve", "revise", "feedback", "Skip", "Skip interaction", "Escape"])(
  "%s maps to its fixed plan review reply",
  async (action) => {
    const onReply = vi.fn();
    const screen = await render(
      <UiLocaleProvider locale="en">
        <PlanReviewDock
          request={request}
          connected
          pending={null}
          shortcutsEnabled
          onReply={onReply}
        />
      </UiLocaleProvider>,
    );
    try {
      if (action === "approve" || action === "revise")
        await screen
          .getByRole("button", {
            name: action === "approve" ? /Approve and execute/ : /Continue planning/,
          })
          .click();
      else if (action === "feedback") {
        await screen.getByRole("textbox").fill("Keep data");
        await screen.getByRole("button", { name: "Submit", exact: true }).click();
      } else if (action === "Escape") {
        await screen.getByRole("textbox").fill("Unsubmitted");
        await userEvent.keyboard("{Escape}");
      } else await screen.getByRole("button", { name: action, exact: true }).click();
      expect(onReply).toHaveBeenCalledWith(
        request,
        action === "approve"
          ? { kind: "approve" }
          : action === "revise" || action === "feedback"
            ? { kind: "revise", feedback: action === "feedback" ? "Keep data" : "" }
            : { kind: "takeover" },
      );
    } finally {
      await screen.unmount();
    }
  },
);

test("choosing approve after drafting feedback uses the explicit fixed choice", async () => {
  const onReply = vi.fn();
  const screen = await render(
    <UiLocaleProvider locale="en">
      <PlanReviewDock
        request={request}
        connected
        pending={null}
        shortcutsEnabled
        onReply={onReply}
      />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("textbox").fill("Unsubmitted feedback");
    await screen.getByRole("button", { name: /Approve and execute/ }).click();
    expect(onReply).toHaveBeenCalledWith(request, { kind: "approve" });
  } finally {
    await screen.unmount();
  }
});
