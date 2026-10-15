import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Button, ButtonLink } from "../../src/components/motion/button/base";
import { StatefulButton } from "../../src/components/motion/button/stateful";
import { Input } from "../../src/components/motion/input";
import "../../src/theme.css";

test("shared controls render compact geometry and grow with interface text", async () => {
  const screen = await render(
    <div>
      <Button size="sm">
        <svg aria-hidden="true" viewBox="0 0 24 24" />
        Small
      </Button>
      <Button size="xs">Micro</Button>
      <Button>Standard</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Icon">
        <svg aria-hidden="true" viewBox="0 0 24 24" />
      </Button>
      <ButtonLink href="#target">Link</ButtonLink>
      <Input label="Field" defaultValue="Value" />
      <span className="text-ui-caption">Caption</span>
    </div>,
  );
  try {
    for (const [name, height] of [
      ["Small", 28],
      ["Micro", 24],
      ["Standard", 32],
      ["Large", 36],
    ] as const) {
      const element = screen.getByRole("button", { name, exact: true }).element();
      expect(element.getBoundingClientRect().height).toBe(height);
      expect(getComputedStyle(element).fontSize).toBe(
        name === "Small" ? "13px" : name === "Micro" ? "12px" : "14px",
      );
      expect(getComputedStyle(element).borderRadius).toBe(
        name === "Small" || name === "Micro" ? "6px" : "8px",
      );
      expect(getComputedStyle(element).lineHeight).toBe(
        name === "Small" ? "19.5px" : name === "Micro" ? "18px" : "21px",
      );
    }
    const icon = screen.getByRole("button", { name: "Icon", exact: true }).element();
    expect(icon.getBoundingClientRect().width).toBe(24);
    expect(icon.getBoundingClientRect().height).toBe(24);
    expect(getComputedStyle(icon).borderRadius).toBe("6px");
    expect(icon.querySelector("svg")!.getBoundingClientRect().width).toBe(12);
    expect(
      screen
        .getByRole("button", { name: "Small", exact: true })
        .element()
        .querySelector("svg")!
        .getBoundingClientRect().width,
    ).toBe(12);
    const standardStyle = getComputedStyle(
      screen.getByRole("button", { name: "Standard", exact: true }).element(),
    );
    expect(standardStyle.paddingLeft).toBe("10px");
    expect(standardStyle.columnGap).toBe("6px");
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Large", exact: true }).element())
        .paddingLeft,
    ).toBe("12px");
    expect(
      screen.getByRole("link", { name: "Link" }).element().getBoundingClientRect().height,
    ).toBe(32);
    const field = screen.getByRole("textbox", { name: "Field" }).element();
    expect(field.parentElement?.getBoundingClientRect().height).toBe(32);
    expect(getComputedStyle(field).fontSize).toBe("14px");
    expect(getComputedStyle(screen.getByText("Caption").element()).fontSize).toBe("13px");
    expect(getComputedStyle(screen.getByText("Caption").element()).lineHeight).toBe("20px");
    screen
      .getByText("Caption")
      .element()
      .parentElement?.style.setProperty("--ui-font-size", "20px");
    const standard = screen.getByRole("button", { name: "Standard", exact: true }).element();
    expect(standard.getBoundingClientRect().height).toBeGreaterThan(32);
    expect(standard.scrollHeight).toBeLessThanOrEqual(standard.clientHeight);
    expect(field.parentElement?.getBoundingClientRect().height).toBeGreaterThan(32);
  } finally {
    await screen.unmount();
  }
});

test("stateful labels and validation remain readable and actionable", async () => {
  const action = vi.fn();
  const screen = await render(
    <div style={{ width: 320 }}>
      <StatefulButton state="error" errorText="请检查设置并重新执行这个操作" onClick={action}>
        Retry
      </StatefulButton>
      <Input label="Token" defaultValue="invalid" error="请检查令牌" />
    </div>,
  );
  try {
    const retry = screen.getByRole("button", { name: "请检查设置并重新执行这个操作" });
    await expect.element(retry).toBeVisible();
    await retry.click();
    expect(action).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("请检查令牌");
    await expect
      .element(screen.getByRole("textbox", { name: "Token" }))
      .toHaveAttribute("aria-invalid", "true");
  } finally {
    await screen.unmount();
  }
});
