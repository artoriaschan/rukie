import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { promptText } from "../helpers/prompt";
import { PromptInput } from "../../src/components/agents/prompt-input";
import "../../src/theme.css";

test("composer model options preserve compact rows and selection", async () => {
  const changed = vi.fn();
  const screen = await render(
    <PromptInput
      models={[
        { value: "first", label: "First model" },
        { value: "second", label: "Second model" },
      ]}
      onModelChange={changed}
    />,
  );
  try {
    await screen.getByRole("button", { name: "First model", exact: true }).click();
    const second = screen.getByRole("option", { name: "Second model", exact: true });
    expect(second.element().getBoundingClientRect().height).toBe(32);
    expect(second.element().parentElement!.getBoundingClientRect().height).toBe(32);
    expect(getComputedStyle(second.element().parentElement!).listStyleType).toBe("none");
    await second.click();
    expect(changed).toHaveBeenCalledWith("second");
    await expect
      .element(screen.getByRole("button", { name: "Second model", exact: true }))
      .toBeVisible();
  } finally {
    await screen.unmount();
  }
});

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

test("plain-text composer keeps composition, line breaks and paste in the editable surface", async () => {
  const sent = vi.fn();
  const changed = vi.fn();
  const screen = await render(<PromptInput onSubmit={sent} onValueChange={changed} />);
  try {
    const input = screen.getByRole("textbox");
    await expect.element(input).toHaveAttribute("contenteditable", "true");
    await input.fill("编译器");
    input.element().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
      );
    expect(sent).not.toHaveBeenCalled();
    input
      .element()
      .dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "编译器" }));
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect.poll(() => changed.mock.lastCall?.[0]).toBe("编译器\n");
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "plain\ntext");
    clipboardData.setData("text/html", "<b>rich text must not replace the plain draft</b>");
    input
      .element()
      .dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
      );
    await expect.poll(() => changed.mock.lastCall?.[0]).toBe("编译器\nplain\ntext");
    await userEvent.keyboard("{Enter}");
    expect(sent).toHaveBeenCalledWith("编译器\nplain\ntext", undefined);
    await expect.element(input).toHaveFocus();
    await expect.poll(() => promptText(input.element())).toBe("");
  } finally {
    await screen.unmount();
  }
});

test("disabled and submitting composers preserve drafts and reject sending", async () => {
  const sent = vi.fn();
  const screen = await render(<PromptInput value="  keep this draft  " disabled onSubmit={sent} />);
  try {
    const input = screen.getByRole("textbox");
    await expect.element(input).toHaveAttribute("contenteditable", "false");
    await expect.element(input).toHaveAttribute("aria-disabled", "true");
    expect(getComputedStyle(input.element()).cursor).toBe("not-allowed");
    expect(promptText(input.element())).toBe("  keep this draft  ");
    input.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(sent).not.toHaveBeenCalled();
    await screen.rerender(<PromptInput value="  keep this draft  " submitting onSubmit={sent} />);
    await expect.element(input).toHaveAttribute("contenteditable", "true");
    await input.click();
    await userEvent.keyboard("{Enter}");
    expect(sent).not.toHaveBeenCalled();
    expect(promptText(input.element())).toBe("  keep this draft  ");
    await expect.element(screen.getByRole("button", { name: "Send prompt" })).toBeDisabled();
  } finally {
    await screen.unmount();
  }
});
