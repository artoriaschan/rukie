import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { Input } from "../../src/components/motion/input";
import "../../src/theme.css";

test.each([false, true])(
  "Input keeps its rounded focus indicator inside a scrolling container (error=%s)",
  async (error) => {
    const screen = await render(
      <div style={{ overflowY: "auto", width: 300 }}>
        <Input aria-label="Title" error={error} />
      </div>,
    );
    try {
      const input = screen.getByRole("textbox", { name: "Title" });
      const field = input.element().parentElement!;
      const baseline = field.getBoundingClientRect();
      input.element().focus();
      await expect.element(input).toHaveFocus();
      await expect.poll(() => getComputedStyle(field).boxShadow).toContain("inset");
      expect(getComputedStyle(field).borderRadius).toBe("8px");
      expect(getComputedStyle(input.element()).outlineStyle).toBe("none");
      const focused = field.getBoundingClientRect();
      for (const key of ["left", "top", "width", "height"] as const)
        expect(focused[key]).toBe(baseline[key]);
    } finally {
      await screen.unmount();
    }
  },
);
