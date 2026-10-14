import { createPortal } from "react-dom";
import { expect, onTestFinished, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../../src/components/motion/select";
import theme from "../../src/theme.css?inline";

test("Select options stay compact without the browser test runner's list reset", async () => {
  // The runner supplies global li styles absent from the production preview.
  // An iframe gives the component only the production stylesheet.
  const frame = document.createElement("iframe");
  document.body.append(frame);
  onTestFinished(() => frame.remove());
  const content = frame.contentDocument!;
  content.head.innerHTML = `<style>${theme}</style>`;
  const changed = vi.fn();
  const screen = await render(
    createPortal(
      <Select defaultValue="first" onValueChange={changed}>
        <SelectTrigger>API format</SelectTrigger>
        <SelectContent>
          <SelectItem value="first">First format</SelectItem>
          <SelectItem value="second">Second format</SelectItem>
        </SelectContent>
      </Select>,
      content.body,
    ),
  );
  try {
    content.querySelector<HTMLButtonElement>("button")!.click();
    const options = Array.from(content.querySelectorAll<HTMLElement>("[role=option]"));
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(frame.contentWindow!.getComputedStyle(option).transitionDuration).toBe("0s");
      expect(frame.contentWindow!.getComputedStyle(option.parentElement!).listStyleType).toBe(
        "none",
      );
      expect(option.parentElement!.getBoundingClientRect().height).toBe(
        option.getBoundingClientRect().height,
      );
      expect(option.getBoundingClientRect().height).toBe(32);
    }
    options[1]!.click();
    expect(changed).toHaveBeenCalledWith("second");
  } finally {
    await screen.unmount();
    frame.remove();
  }
});
