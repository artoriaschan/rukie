import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  CenterMorphModal,
  CenterMorphModalContent,
  CenterMorphModalTrigger,
} from "../../src/components/motion/center-morph-modal";
import { Button } from "../../src/components/motion/button/base";
import "../../src/theme.css";

test("long center modal scrolls only its body and retains title, footer, and close control", async () => {
  await page.viewport(420, 700);
  const screen = await render(
    <CenterMorphModal>
      <CenterMorphModalTrigger>
        <Button>Open review</Button>
      </CenterMorphModalTrigger>
      <CenterMorphModalContent ariaLabel="Review details">
        <h2 className="shrink-0 px-4 py-3 pr-16 text-ui-base">Review title</h2>
        <div role="region" aria-label="Review body" className="min-h-0 overflow-y-auto px-4">
          {Array.from({ length: 60 }, (_, index) => (
            <p key={index} className="py-2 text-ui-base">{`Review paragraph ${index}`}</p>
          ))}
        </div>
        <footer className="shrink-0 p-4">
          <Button>Confirm review</Button>
        </footer>
      </CenterMorphModalContent>
    </CenterMorphModal>,
  );
  try {
    const trigger = screen.getByRole("button", { name: "Open review" });
    await trigger.click();
    const dialog = screen.getByRole("dialog", { name: "Review details" });
    const body = screen.getByRole("region", { name: "Review body" });
    const heading = screen.getByRole("heading", { name: "Review title" });
    const confirm = screen.getByRole("button", { name: "Confirm review" });
    const close = screen.getByRole("button", { name: "Close modal", exact: true });
    await expect.element(dialog).toBeVisible();
    await expect.poll(() => body.element().scrollHeight > body.element().clientHeight).toBe(true);
    const titleTop = heading.element().getBoundingClientRect().top;
    const footerTop = confirm.element().getBoundingClientRect().top;
    body.element().scrollTop = body.element().scrollHeight;
    await expect.poll(() => body.element().scrollTop).toBeGreaterThan(0);
    expect(heading.element().getBoundingClientRect().top).toBe(titleTop);
    expect(confirm.element().getBoundingClientRect().top).toBe(footerTop);
    expect(dialog.element().scrollTop).toBe(0);
    expect(confirm.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight - 16);
    expect(close.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(16);
    await expect.element(confirm).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});
