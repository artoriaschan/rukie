import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PromptInput } from "../../src/components/agents/prompt-input";
import "../../src/theme.css";

test("composer reflows enlarged text at narrow width without clipping actions", async () => {
  const root = document.documentElement;
  const previous = root.style.getPropertyValue("--ui-font-size");
  await page.viewport(420, 700);
  const screen = await render(
    <div className="px-4">
      <PromptInput defaultValue="A long command and translated explanation that wraps across several lines in the narrow composer." />
    </div>,
  );
  try {
    const field = screen.getByRole("textbox").element();
    const submit = screen.getByRole("button", { name: "Send prompt" });
    const firstHeight = field.getBoundingClientRect().height;
    root.style.setProperty("--ui-font-size", "18px");
    await expect.poll(() => field.getBoundingClientRect().height).toBeGreaterThan(firstHeight);
    await expect.element(submit).toBeVisible();
    const box = submit.element().getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(innerWidth - 16);
    expect(box.left).toBeGreaterThanOrEqual(16);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    expect(getComputedStyle(field).fontSize).toBe("18px");
  } finally {
    if (previous) root.style.setProperty("--ui-font-size", previous);
    else root.style.removeProperty("--ui-font-size");
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});
