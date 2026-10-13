import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test("sidebar titles follow Pencil and session hover changes immediately without a selected fill", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    const first = screen.getByRole("button", { name: "Fix compiler", exact: true });
    const second = screen.getByRole("button", { name: "Explore ideas", exact: true });
    const newChat = screen.getByRole("button", { name: "New chat", exact: true });
    const toggle = screen.getByRole("button", { name: "Toggle sidebar", exact: true });
    await expect.element(toggle).toBeVisible();
    if (toggle.element().getAttribute("aria-pressed") !== "true") await toggle.click();
    await expect.element(first).toBeVisible();
    const sidebar = screen.getByRole("complementary", { name: "Home", exact: true }).element();
    for (const section of sidebar.querySelectorAll("section")) {
      const heading = section.querySelector("button[aria-expanded]");
      expect(heading).not.toBeNull();
      expect(getComputedStyle(heading!).fontSize).toBe("14px");
      expect(getComputedStyle(heading!).fontWeight).toBe("400");
    }
    for (const session of [first, second]) {
      expect(getComputedStyle(session.element()).fontSize).toBe("14px");
      expect(getComputedStyle(session.element()).fontWeight).toBe("400");
      expect(session.element().getBoundingClientRect().height).toBe(32);
    }
    await first.click();
    await expect.element(first).toHaveAttribute("aria-current", "page");
    await newChat.hover();
    const firstRow = first.element().parentElement!;
    const secondRow = second.element().parentElement!;
    expect(getComputedStyle(firstRow).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(secondRow).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    await userEvent.keyboard("{Control>}");
    expect(sidebar.querySelector("kbd")).toBeNull();
    await userEvent.keyboard("{/Control}");
    await first.hover();
    const hoverColor = getComputedStyle(firstRow).backgroundColor;
    expect(hoverColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(firstRow).transitionDuration).toBe("0s");
    await second.hover();
    expect(getComputedStyle(firstRow).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(secondRow).backgroundColor).toBe(hoverColor);
    expect(getComputedStyle(secondRow).transitionDuration).toBe("0s");
    expect(firstRow.getAnimations()).toHaveLength(0);
    expect(secondRow.getAnimations()).toHaveLength(0);
    first.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(first).toHaveAttribute("aria-current", "page");
  } finally {
    await userEvent.keyboard("{/Control}");
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
