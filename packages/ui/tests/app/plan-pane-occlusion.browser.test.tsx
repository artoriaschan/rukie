import { expect, test } from "vitest";
import { commands, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test("narrow plan overlay hides conversation navigation and scrollbar and restores their reading position", async () => {
  await page.viewport(1440, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await screen.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
    await page.viewport(420, 800);
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "snapshot",
        sessionId: "one",
        model: "test/script",
        compactions: [],
        toolStates: {},
        messages: [
          ...Array.from({ length: 8 }, (_, index) => [
            {
              role: "user",
              timestamp: index * 2 + 1,
              entryId: `u${index}`,
              content: `Question ${index}`,
            },
            {
              role: "assistant",
              timestamp: index * 2 + 2,
              entryId: `a${index}`,
              content: [
                { type: "text", text: `Answer ${index}\n\n${"Keep reading.\n\n".repeat(4)}` },
              ],
            },
          ]).flat(),
          {
            role: "assistant",
            timestamp: 20,
            entryId: "plan",
            content: [
              {
                type: "toolCall",
                id: "plan",
                name: "exit_plan_mode",
                arguments: { plan: "# Read safely\n\nKeep reading position." },
              },
            ],
          },
        ],
      }),
    });
    const feedLocator = screen.getByRole("feed");
    const feed = feedLocator.element();
    const navigation = screen.getByRole("button", { name: "Jump to response 1", exact: true });
    const scrollbar = screen.getByRole("scrollbar", {
      name: "Conversation scroll position",
      exact: true,
    });
    await expect.element(navigation).toBeVisible();
    await expect.element(scrollbar).toBeVisible();
    await expect.poll(() => feed.scrollHeight > feed.clientHeight).toBe(true);
    // Native wheel input cancels the virtualizer's initial following scroll.
    await feedLocator.wheel({ delta: { y: -10000 } });
    await expect.element(screen.getByText("Answer 0", { exact: true })).toBeVisible();
    await expect.poll(() => feed.scrollTop).toBe(0);
    const rail = navigation.element();
    const scroll = scrollbar.element();
    const paints = (element: Element) => element.checkVisibility({ opacityProperty: true });
    expect(paints(rail)).toBe(true);
    expect(paints(scroll)).toBe(true);
    const geometry = () => ({
      width: feed.clientWidth,
      height: feed.clientHeight,
      scroll: feed.scrollTop,
    });
    const baseline = geometry();
    await screen.getByRole("button", { name: "Session summary", exact: true }).click();
    await screen
      .getByRole("complementary", { name: "Session summary", exact: true })
      .getByRole("button", { name: "Read safely", exact: true })
      .click();
    const pane = screen.getByRole("complementary", { name: "Plan side pane", exact: true });
    await expect.element(pane).toBeVisible();
    expect(paints(rail), "underlying response ticks must not paint over the plan").toBe(false);
    expect(paints(scroll), "underlying scrollbar must not paint over the plan").toBe(false);
    expect(geometry()).toEqual(baseline);
    await page.viewport(1440, 900);
    await expect.poll(() => paints(rail) && paints(scroll)).toBe(true);
    await expect.element(navigation).toBeVisible();
    await expect.element(scrollbar).toBeVisible();
    await page.viewport(420, 800);
    await expect.poll(() => paints(rail) || paints(scroll)).toBe(false);
    await pane.getByRole("button", { name: "Close side pane", exact: true }).click();
    await expect.element(pane).not.toBeInTheDocument();
    expect(screen.getByRole("feed").element()).toBe(feed);
    expect(paints(rail)).toBe(true);
    expect(paints(scroll)).toBe(true);
    expect(geometry()).toEqual(baseline);
    await expect.element(screen.getByText("Answer 0", { exact: true })).toBeVisible();
    await navigation.click();
    await expect.element(screen.getByText("Answer 0", { exact: true })).toBeVisible();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
