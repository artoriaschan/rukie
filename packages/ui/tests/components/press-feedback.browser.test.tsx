import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Button, type ButtonVariant } from "../../src/components/motion/button/base";
import { Checkbox } from "../../src/components/motion/checkbox";
import { RadioGroup, RadioGroupItem } from "../../src/components/motion/radio";
import { Switch } from "../../src/components/motion/switch";
import "../../src/theme.css";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "outline", "destructive"];

function look(element: Element) {
  const style = getComputedStyle(element);
  return {
    backgroundColor: style.backgroundColor,
    color: style.color,
    borderColor: style.borderColor,
    boxShadow: style.boxShadow,
    opacity: style.opacity,
    transform: style.transform,
  };
}

/** Clicks `element` and returns its computed look while the pointer is held down. */
async function pointerPressedLook(element: Element, click: () => Promise<void>) {
  let pressed: ReturnType<typeof look> | undefined;
  let active = false;
  const observe = () => {
    active = element.matches(":active");
    pressed = look(element);
  };
  element.addEventListener("pointerdown", observe);
  try {
    await click();
  } finally {
    element.removeEventListener("pointerdown", observe);
  }
  expect(active).toBe(true);
  return pressed;
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} pressing a button or choice control keeps its hover and focus appearance`, async () => {
    const screen = await render(
      <div className={theme}>
        <button type="button">Start</button>
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
        <Button variant="ghost" size="icon" aria-label="Icon action">
          <svg aria-hidden="true" viewBox="0 0 24 24" />
        </Button>
        <Checkbox label="Pressed checkbox" checked={false} onCheckedChange={() => {}} />
        <Switch label="Pressed switch" checked={false} onCheckedChange={() => {}} />
        <RadioGroup defaultValue="b" aria-label="Pressed choice">
          <RadioGroupItem value="a" label="Pressed radio" />
          <RadioGroupItem value="b" label="Other radio" />
        </RadioGroup>
      </div>,
    );
    try {
      const targets = [
        ...VARIANTS.map((name) => screen.getByRole("button", { name, exact: true })),
        screen.getByRole("button", { name: "Icon action", exact: true }),
        screen.getByRole("checkbox", { name: "Pressed checkbox", exact: true }),
        screen.getByRole("switch", { name: "Pressed switch", exact: true }),
      ];
      for (const target of targets) {
        const element = target.element();
        await target.hover();
        const hovered = look(element);
        expect(
          await pointerPressedLook(element, () => target.click()),
          element.textContent!,
        ).toEqual(hovered);
      }
      const radio = screen.getByRole("radio", { name: "Pressed radio", exact: true });
      await radio.hover();
      const hoveredRadio = look(radio.element());
      expect(await pointerPressedLook(radio.element(), () => radio.click())).toEqual(hoveredRadio);
      await screen.getByRole("radio", { name: "Other radio", exact: true }).hover();
      screen.getByRole("button", { name: "Start", exact: true }).element().focus();
      for (const name of VARIANTS) {
        const button = screen.getByRole("button", { name, exact: true });
        // Tab establishes keyboard modality so :focus-visible is drawn before the press.
        await userEvent.keyboard("{Tab}");
        await expect.element(button).toHaveFocus();
        const focused = look(button.element());
        await userEvent.keyboard("{Space>}");
        try {
          expect(button.element().matches(":active")).toBe(true);
          expect(look(button.element()), name).toEqual(focused);
        } finally {
          await userEvent.keyboard("{/Space}");
        }
      }
    } finally {
      await screen.unmount();
    }
  });
}
