import type { CSSProperties } from "react";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Button } from "../../src/components/motion/button/base";
import { Input } from "../../src/components/motion/input";
import { MorphingModal } from "../../src/components/motion/morphing-modal";
import { Switch } from "../../src/components/motion/switch";
import { Select, SelectTrigger, SelectValue } from "../../src/components/motion/select";
import "../../src/theme.css";

for (const font of [14, 18]) {
  test(`shared control owner variants retain accessible geometry at ${font}px and 420px`, async () => {
    await page.viewport(420, 700);
    const activated = vi.fn();
    const style: CSSProperties & { "--ui-font-size": string } = { "--ui-font-size": `${font}px` };
    const screen = await render(
      <div style={style}>
        <Button size="standard" onClick={activated}>
          <span>Action</span>
          <svg />
        </Button>
        <Button size="compact" disabled onClick={activated}>
          <span>Disabled</span>
          <svg />
        </Button>
        <Button size="icon" focus="inset" aria-label="Titlebar">
          <svg />
        </Button>
        <Input label="Generic" error="Validation message" />
        <Input size="scoped" label="Project" />
        <Switch size="provider" checked={false} onCheckedChange={activated} label="Provider" />
        <Select disabled>
          <SelectTrigger size="scoped" aria-label="Settings">
            <SelectValue />
          </SelectTrigger>
        </Select>
      </div>,
    );
    try {
      const action = screen.getByRole("button", { name: "Action", exact: true });
      const disabled = screen.getByRole("button", { name: "Disabled", exact: true });
      for (const [target, cursor] of [
        [action, "pointer"],
        [disabled, "not-allowed"],
      ] as const) {
        const element = target.element();
        for (const child of [element, ...element.querySelectorAll("svg,span")])
          expect(getComputedStyle(child).cursor).toBe(cursor);
        expect(element.scrollHeight).toBeLessThanOrEqual(element.clientHeight);
      }
      expect(getComputedStyle(disabled.element()).opacity).toBe("0.5");
      await disabled.click({ force: true });
      disabled.element().focus();
      await userEvent.keyboard("{Enter}{Space}");
      expect(activated).not.toHaveBeenCalled();
      action.element().focus();
      await userEvent.keyboard("{Enter}{Space}");
      expect(activated).toHaveBeenCalledTimes(2);
      const field = screen.getByRole("textbox", { name: "Generic" }).element();
      expect(field.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").element().id);
      expect(field.parentElement!.getBoundingClientRect().height).toBeGreaterThanOrEqual(36);
      expect(getComputedStyle(field.parentElement!).borderRadius).toBe("12px");
      expect(
        screen
          .getByRole("textbox", { name: "Project" })
          .element()
          .parentElement!.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(32);
      const provider = screen.getByRole("switch", { name: "Provider" }).element();
      expect(provider.getBoundingClientRect().width).toBe(32);
      expect(provider.getBoundingClientRect().height).toBe(18);
      expect(provider.firstElementChild!.getBoundingClientRect().width).toBe(14);
      const select = screen.getByRole("button", { name: "Settings" }).element();
      for (const child of [select, ...select.querySelectorAll("svg,span")])
        expect(getComputedStyle(child).cursor).toBe("not-allowed");
      expect(document.documentElement.scrollWidth).toBe(420);
    } finally {
      await screen.unmount();
      await page.viewport(1280, 900);
    }
  });
}

test("MorphingModal clamps its shell and keeps title and actions visible while body scrolls", async () => {
  await page.viewport(420, 420);
  const screen = await render(
    <MorphingModal viewId="details" onClose={() => {}} placement="center" label="Details">
      <h2 className="shrink-0">Heading</h2>
      <div role="region" aria-label="Body" className="min-h-0 overflow-y-auto">
        {Array.from({ length: 60 }, (_, index) => (
          <p key={index}>Body paragraph {index}</p>
        ))}
      </div>
      <footer className="shrink-0">
        <Button size="standard">Confirm</Button>
      </footer>
    </MorphingModal>,
  );
  try {
    const dialog = screen.getByRole("dialog", { name: "Details" }).element();
    const body = screen.getByRole("region", { name: "Body" }).element();
    await expect.poll(() => body.scrollHeight > body.clientHeight).toBe(true);
    expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(388);
    expect(dialog.getBoundingClientRect().height).toBeLessThanOrEqual(388);
    expect(getComputedStyle(dialog.firstElementChild!).padding).toBe("24px 16px");
    const heading = screen.getByRole("heading").element().getBoundingClientRect().top;
    const footer = screen
      .getByRole("button", { name: "Confirm" })
      .element()
      .getBoundingClientRect().top;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(screen.getByRole("heading").element().getBoundingClientRect().top).toBe(heading);
    expect(
      screen.getByRole("button", { name: "Confirm" }).element().getBoundingClientRect().top,
    ).toBe(footer);
    expect(footer + 36).toBeLessThanOrEqual(404);
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});
