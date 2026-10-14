import { expect, onTestFinished, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Button } from "../../src/components/motion/button/base";
import { useState } from "react";
import { Input } from "../../src/components/motion/input";
import { Checkbox } from "../../src/components/motion/checkbox";
import { RadioGroup, RadioGroupItem } from "../../src/components/motion/radio";
import { Switch } from "../../src/components/motion/switch";
import { UiLocaleProvider } from "../../src/lib/i18n";
import {
  SessionDropdownItems,
  SessionContextItems,
  sessionActions,
} from "../../src/components/session-actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "../../src/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
} from "../../src/components/motion/context-menu";
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
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
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

for (const theme of ["light", "dark"] as const) {
  test(`${theme} F01 keyboard control focus survives pointer hover and disabled controls stay inert`, async () => {
    const action = vi.fn();
    const screen = await render(
      <div className={theme}>
        <Button>Start focus</Button>
        <Checkbox label="Focused checkbox" checked={false} onCheckedChange={action} />
        <Switch label="Focused switch" checked={false} onCheckedChange={action} />
        <RadioGroup defaultValue="a" aria-label="Focused choice">
          <RadioGroupItem value="a" label="Focused radio" />
        </RadioGroup>
        <Checkbox disabled label="Disabled checkbox" checked={false} onCheckedChange={action} />
        <Switch disabled label="Disabled switch" checked={false} onCheckedChange={action} />
        <RadioGroup defaultValue="a" aria-label="Disabled choice">
          <RadioGroupItem disabled value="a" label="Disabled radio" />
        </RadioGroup>
      </div>,
    );
    try {
      const start = screen.getByRole("button", { name: "Start focus" });
      await start.click();
      for (const [role, name] of [
        ["checkbox", "Focused checkbox"],
        ["switch", "Focused switch"],
        ["radio", "Focused radio"],
      ] as const) {
        await start.hover();
        await userEvent.keyboard("{Tab}");
        const control = screen.getByRole(role, { name, exact: true });
        await expect.element(control).toHaveFocus();
        const focused = getComputedStyle(control.element()).boxShadow;
        expect(focused).not.toBe("none");
        await control.hover();
        expect(getComputedStyle(control.element()).boxShadow).toBe(focused);
      }
      for (const [role, name] of [
        ["checkbox", "Disabled checkbox"],
        ["switch", "Disabled switch"],
        ["radio", "Disabled radio"],
      ] as const) {
        const control = screen.getByRole(role, { name, exact: true });
        const resting = getComputedStyle(control.element()).boxShadow;
        await control.hover();
        expect(getComputedStyle(control.element()).boxShadow).toBe(resting);
        expect(getComputedStyle(control.element()).cursor).toBe("not-allowed");
        await expect.element(control).toBeDisabled();
      }
      expect(action).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });
}

function drawnMenuBackground(item: Element) {
  const menu = item.closest<HTMLElement>('[role="menu"]')!;
  const highlight = [...item.children].find(
    (child) => getComputedStyle(child).position === "absolute",
  );
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.fillStyle = getComputedStyle(menu).backgroundColor;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = getComputedStyle(highlight ?? item).backgroundColor;
  context.fillRect(0, 0, 1, 1);
  return `rgb(${[...context.getImageData(0, 0, 1, 1).data].slice(0, 3).join(", ")})`;
}
for (const theme of ["light", "dark"] as const) {
  for (const kind of ["dropdown", "context"] as const) {
    test(`${theme} F01 ${kind} Session Delete remains readable through highlighted states`, async () => {
      const previous = document.documentElement.className;
      let screen: Awaited<ReturnType<typeof render>> | undefined;
      let cleanupPromise: Promise<void> | undefined;
      const cleanup = () =>
        (cleanupPromise ??= (async () => {
          try {
            await screen?.unmount();
          } finally {
            document.documentElement.className = previous;
          }
        })());
      onTestFinished(cleanup);
      document.documentElement.className = theme;
      const remove = vi.fn();
      const actions = sessionActions(
        {
          id: "one",
          title: "History",
          titleSource: "prompt",
          cwd: "/project",
          projectId: "project",
          model: "test/script",
          createdAt: 1,
          updatedAt: 2,
          messageCount: 1,
        },
        false,
        () => {},
        () => {},
        () => {},
        remove,
        [],
        () => {},
        () => {},
      );
      screen = await render(
        <UiLocaleProvider locale="en">
          {kind === "dropdown" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>Session actions</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <SessionDropdownItems actions={actions} />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <ContextMenu>
              <ContextMenuTrigger>
                <Button>Session actions</Button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <SessionContextItems actions={actions} />
              </ContextMenuContent>
            </ContextMenu>
          )}
        </UiLocaleProvider>,
      );
      try {
        const trigger = screen.getByRole("button", { name: "Session actions", exact: true });
        await trigger.click(kind === "context" ? { button: "right" } : undefined);
        const item = screen.getByRole("menuitem", { name: "Permanently delete", exact: true });
        await expect.element(item).toBeVisible();
        expect(
          contrast(getComputedStyle(item.element()).color, drawnMenuBackground(item.element())),
        ).toBeGreaterThanOrEqual(4.5);
        await item.hover();
        await expect.element(item).toHaveFocus();
        expect(
          contrast(getComputedStyle(item.element()).color, drawnMenuBackground(item.element())),
        ).toBeGreaterThanOrEqual(4.5);
        await userEvent.keyboard("{End}");
        await expect.element(item).toHaveFocus();
        expect(
          contrast(getComputedStyle(item.element()).color, drawnMenuBackground(item.element())),
        ).toBeGreaterThanOrEqual(4.5);
        let pressedContrast = 0;
        let pressed = false;
        const observePress = (event: PointerEvent) => {
          if (event.target instanceof Node && item.element().contains(event.target)) {
            pressed = item.element().matches(":active");
            pressedContrast = contrast(
              getComputedStyle(item.element()).color,
              drawnMenuBackground(item.element()),
            );
          }
        };
        document.addEventListener("pointerdown", observePress);
        try {
          await item.click();
        } finally {
          document.removeEventListener("pointerdown", observePress);
        }
        expect(pressed).toBe(true);
        expect(pressedContrast).toBeGreaterThanOrEqual(4.5);
        expect(remove).toHaveBeenCalledOnce();
      } finally {
        await cleanup();
      }
    });
  }
}
