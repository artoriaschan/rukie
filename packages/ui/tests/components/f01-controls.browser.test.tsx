import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Button } from "../../src/components/motion/button/base";
import { useState } from "react";
import { Input } from "../../src/components/motion/input";
import { Checkbox } from "../../src/components/motion/checkbox";
import { RadioGroup, RadioGroupItem } from "../../src/components/motion/radio";
import { Switch } from "../../src/components/motion/switch";
import { AnimatedBadge } from "../../src/components/motion/animated-badge";
import "../../src/theme.css";

function Fields() {
  const [checked, setChecked] = useState(false);
  const [on, setOn] = useState(false);
  return (
    <>
      <Input label="Name" placeholder="Name placeholder" />
      <Checkbox label="Accept" checked={checked} onCheckedChange={setChecked} />
      <Switch label="Enable" checked={on} onCheckedChange={setOn} />
      <RadioGroup defaultValue="a" aria-label="Choice">
        <RadioGroupItem value="a" label="First" />
        <RadioGroupItem value="b" label="Second" />
      </RadioGroup>
      <AnimatedBadge showIcon={false}>Neutral</AnimatedBadge>
    </>
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} F01 primary keeps its inverse pair and disabled geometry`, async () => {
    const action = vi.fn();
    const screen = await render(
      <div className={theme}>
        <Button onClick={action}>Primary</Button>
        <Button disabled onClick={action}>
          Disabled
        </Button>
        <Button variant="secondary">Secondary</Button>
      </div>,
    );
    try {
      const primary = screen.getByRole("button", { name: "Primary", exact: true });
      const disabled = screen.getByRole("button", { name: "Disabled", exact: true });
      const fill = theme === "light" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
      const text = theme === "light" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)";
      expect(getComputedStyle(primary.element()).backgroundColor).toBe(fill);
      expect(getComputedStyle(primary.element()).color).toBe(text);
      const restingShadow = getComputedStyle(primary.element()).boxShadow;
      await primary.hover();
      expect(getComputedStyle(primary.element()).backgroundColor).toBe(fill);
      expect(getComputedStyle(primary.element()).boxShadow).not.toBe(restingShadow);
      primary.element().focus();
      await userEvent.keyboard("{Space>}");
      expect(getComputedStyle(primary.element()).boxShadow).toContain("2px");
      await userEvent.keyboard("{/Space}");
      await primary.click();
      expect(action).toHaveBeenCalledTimes(2);
      expect(getComputedStyle(disabled.element()).opacity).toBe("0.5");
      expect(getComputedStyle(disabled.element()).cursor).toBe("not-allowed");
      expect(disabled.element().getBoundingClientRect().height).toBe(
        primary.element().getBoundingClientRect().height,
      );
      await disabled.hover();
      expect(getComputedStyle(disabled.element()).backgroundColor).toBe(fill);
      expect(
        getComputedStyle(screen.getByRole("button", { name: "Secondary", exact: true }).element())
          .backgroundColor,
      ).toBe(theme === "light" ? "rgb(230, 230, 230)" : "rgb(54, 54, 54)");
    } finally {
      await screen.unmount();
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} F01 form controls expose neutral selected states and compact marks`, async () => {
    const screen = await render(
      <div className={theme}>
        <Fields />
      </div>,
    );
    try {
      const input = screen.getByRole("textbox", { name: "Name", exact: true }).element();
      expect(getComputedStyle(input).lineHeight).toBe("21px");
      expect(getComputedStyle(input.parentElement!).backgroundColor).toBe(
        theme === "light" ? "rgb(255, 255, 255)" : "rgb(43, 43, 43)",
      );
      expect(getComputedStyle(screen.getByText("Name", { exact: true }).element()).fontWeight).toBe(
        "400",
      );
      const toggle = screen.getByRole("switch", { name: "Enable" });
      expect(toggle.element().getBoundingClientRect().width).toBe(36);
      expect(toggle.element().getBoundingClientRect().height).toBeCloseTo(20, 3);
      expect(getComputedStyle(toggle.element()).backgroundColor).toBe(
        theme === "light" ? "rgb(230, 230, 230)" : "rgb(54, 54, 54)",
      );
      await toggle.click();
      await expect.element(toggle).toHaveAttribute("aria-checked", "true");
      await expect
        .poll(() => getComputedStyle(toggle.element()).backgroundColor)
        .toBe(theme === "light" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)");
      expect(getComputedStyle(toggle.element().firstElementChild!).backgroundColor).toBe(
        theme === "light" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)",
      );
      const checkbox = screen.getByRole("checkbox", { name: "Accept" });
      expect(checkbox.element().getBoundingClientRect().width).toBe(16);
      expect(
        checkbox.element().parentElement!.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(24);
      await checkbox.click();
      await expect.element(checkbox).toHaveAttribute("aria-checked", "true");
      expect(getComputedStyle(checkbox.element()).borderRadius).toBe("4px");
      const radio = screen.getByRole("radio", { name: "First" }).element();
      expect(radio.getBoundingClientRect().width).toBe(16);
      expect(radio.firstElementChild!.getBoundingClientRect().width).toBe(8);
      const badge = screen.getByText("Neutral", { exact: true }).element().closest("span.border")!;
      expect(badge.getBoundingClientRect().height).toBeCloseTo(20, 3);
      expect(getComputedStyle(badge).borderRadius).toBe("6px");
      expect(getComputedStyle(badge).fontSize).toBe("12px");
      expect(getComputedStyle(badge).paddingLeft).toBe("8px");
      expect(getComputedStyle(badge).backgroundColor).toBe(
        theme === "light" ? "rgb(230, 230, 230)" : "rgb(54, 54, 54)",
      );
    } finally {
      await screen.unmount();
    }
  });
}

function rgb(color: string) {
  const values = color.match(/[\d.]+/g)?.map(Number);
  if (!values || values.length < 3) throw new Error(`Unresolved color: ${color}`);
  return values.slice(0, 3);
}
function luminance(color: number[]) {
  return color.reduce((result, channel, index) => {
    const value = channel / 255;
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return result + linear * [0.2126, 0.7152, 0.0722][index]!;
  }, 0);
}
function contrast(a: string, b: string) {
  const first = luminance(rgb(a));
  const second = luminance(rgb(b));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
for (const theme of ["light", "dark"] as const) {
  test(`${theme} F01 readable copy, destructive states and field focus retain contrast`, async () => {
    const screen = await render(
      <div className={theme}>
        <div className="bg-card">
          <span className="text-foreground-subtle">Supporting</span>
          <span className="text-foreground-subtlest">Weak</span>
        </div>
        <Button variant="destructive">Remove</Button>
        <Input label="Focused field" placeholder="Readable placeholder" />
      </div>,
    );
    try {
      const supporting = screen.getByText("Supporting", { exact: true }).element();
      const weak = screen.getByText("Weak", { exact: true }).element();
      const surface = getComputedStyle(supporting.parentElement!).backgroundColor;
      expect(contrast(getComputedStyle(supporting).color, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(getComputedStyle(weak).color, surface)).toBeGreaterThanOrEqual(4.5);
      const remove = screen.getByRole("button", { name: "Remove", exact: true });
      for (const state of ["default", "hover", "pressed"] as const) {
        if (state === "hover") await remove.hover();
        if (state === "pressed") {
          remove.element().focus();
          await userEvent.keyboard("{Space>}");
        }
        const style = getComputedStyle(remove.element());
        expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
        if (state === "pressed") await userEvent.keyboard("{/Space}");
      }
      const field = screen.getByRole("textbox", { name: "Focused field", exact: true });
      await field.click();
      const shell = field.element().parentElement!;
      const style = getComputedStyle(shell);
      expect(style.boxShadow).not.toBe("none");
      const focusColor = style.boxShadow.match(/rgb\([^)]+\)/)?.[0];
      if (!focusColor) throw new Error(`Missing opaque focus indicator: ${style.boxShadow}`);
      expect(contrast(focusColor, style.backgroundColor)).toBeGreaterThanOrEqual(3);
      expect(
        contrast(getComputedStyle(field.element(), "::placeholder").color, style.backgroundColor),
      ).toBeGreaterThanOrEqual(4.5);
    } finally {
      await screen.unmount();
    }
  });
}
