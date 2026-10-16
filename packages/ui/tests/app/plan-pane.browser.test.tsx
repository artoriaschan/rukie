import { expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PlanPane } from "../../src/components/plan-pane";
import { UiLocaleProvider } from "../../src/lib/i18n";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test("restored plans open from preview and Summary, reuse tabs and restore conversation geometry", async () => {
  await page.viewport(1887, 1000);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const snapshot = async (suffix = "") =>
    fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "snapshot",
        sessionId: "one",
        model: "test/script",
        compactions: [],
        messages: [
          { role: "user", timestamp: 1, entryId: "u", content: "Plan a migration" },
          ...["First plan", "Second plan"].map((title, index) => ({
            role: "assistant",
            timestamp: index + 2,
            entryId: `a${index}`,
            content: [
              {
                type: "toolCall",
                id: "reused",
                name: "exit_plan_mode",
                arguments: {
                  plan: `# ${title}\n\n${"Keep data.\n\n".repeat(80)}Final step${suffix}`,
                },
              },
            ],
          })),
        ],
        toolStates: {},
      }),
    });
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await snapshot();
    const preview = screen.getByRole("region", { name: "Plan preview: First plan", exact: true });
    await expect.element(preview).toBeVisible();
    const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await prompt.fill("Preserve draft");
    const composer = prompt.element().closest("form")!;
    const feed = screen.getByRole("feed").element();
    const rect = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const baseline = rect(composer);
    const preserved = [".app-titlebar", ".app-navigation", ".app-session-sidebar", ".app-workspace"]
      .map((selector) => document.querySelector(selector)!)
      .filter(Boolean);
    const shell = preserved.map(rect);
    await preview.getByRole("button", { name: "Expand plan" }).click();
    const pane = screen.getByRole("complementary", { name: "Plan side pane", exact: true });
    await expect.element(pane).toBeVisible();
    expect(composer.getBoundingClientRect().x).toBeLessThan(baseline.x);
    expect(screen.getByRole("feed").element()).toBe(feed);
    expect(preserved.map(rect)).toEqual(shell);
    expect(pane.element().getBoundingClientRect().top).toBe(44);
    expect(getComputedStyle(pane.element()).borderRadius).toBe("12px");
    expect(pane.element().querySelector("[role=tablist]")!.getBoundingClientRect().height).toBe(44);
    expect(
      pane.element().getBoundingClientRect().left -
        composer.closest("[data-conversation-frame]")!.getBoundingClientRect().right,
    ).toBe(4);
    const frames = document.querySelector<HTMLElement>(".conversation-frames")!;
    for (const mainWidth of [959, 960]) {
      await page.viewport(innerWidth + mainWidth - frames.clientWidth, 1000);
      await expect.poll(() => frames.clientWidth).toBe(mainWidth);
      await expect.poll(() => frames.dataset.planOverlay).toBe(mainWidth < 960 ? "true" : "false");
    }
    await page.viewport(1887, 1000);
    await expect.poll(() => frames.dataset.planOverlay).toBe("false");
    const first = pane.getByRole("tab", { name: "First plan", exact: true });
    await expect.element(first).toHaveFocus();
    await preview.getByRole("button", { name: "Expand plan" }).click();
    expect(pane.element().querySelectorAll("[role=tab]")).toHaveLength(1);
    await screen.getByRole("button", { name: "Session summary", exact: true }).click();
    const summary = screen.getByRole("complementary", { name: "Session summary", exact: true });
    await summary.getByRole("button", { name: "Second plan", exact: true }).click();
    await expect.element(summary).not.toBeInTheDocument();
    expect(pane.element().querySelectorAll("[role=tab]")).toHaveLength(2);
    await expect.element(pane.getByRole("tab", { name: "Second plan", exact: true })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(first).toHaveFocus();
    await expect.element(first).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{End}");
    await expect.element(pane.getByRole("tab", { name: "Second plan", exact: true })).toHaveFocus();
    await snapshot(" refreshed");
    await expect
      .element(pane.getByText("Final step refreshed", { exact: true }))
      .toBeInTheDocument();
    const scroll = pane.element().querySelector<HTMLElement>("[data-slot=scroll-area-viewport]")!;
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    scroll.scrollTop = scroll.scrollHeight;
    await expect.element(pane.getByText("Final step refreshed", { exact: true })).toBeVisible();
    await pane.getByRole("button", { name: "Close plan tab: Second plan", exact: true }).click();
    await expect.element(first).toHaveFocus();
    await pane.getByRole("button", { name: "Close side pane", exact: true }).click();
    await expect.element(pane).not.toBeInTheDocument();
    expect(rect(composer)).toEqual(baseline);
    await expect.element(prompt).toHaveValue("Preserve draft");
    await preview.getByRole("button", { name: "Expand plan" }).click();
    await pane.getByRole("button", { name: "Close plan tab: First plan", exact: true }).click();
    await expect.element(pane).not.toBeInTheDocument();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("Plan pane keeps narrow targets accessible in both themes and shares full-plan actions", async () => {
  await page.viewport(420, 800);
  const title = "Restored long plan title ".repeat(20);
  const plan = {
    id: "restored:1",
    toolId: "call",
    title,
    plan: `# ${title}\n\n**Preserve data**\n\nFinal instruction`,
  };
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:plan");
  const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const downloads: { name: string; href: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, href: this.href });
  });
  const close = vi.fn();
  const screen = await render(
    <UiLocaleProvider locale="en">
      <div
        className="conversation-frames"
        data-plan-open="true"
        data-plan-overlay="true"
        style={{ height: 700 }}
      >
        <PlanPane
          plans={[plan]}
          active={plan.id}
          focusRequest={1}
          onSelect={() => {}}
          onCloseTab={close}
          onClose={close}
        />
      </div>
    </UiLocaleProvider>,
  );
  try {
    const pane = screen.getByRole("complementary", { name: "Plan side pane" });
    const tab = pane.getByRole("tab", { name: title, exact: true });
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle("dark", dark);
      expect(getComputedStyle(pane.element()).backgroundColor).toBe(
        dark ? "rgb(33, 33, 33)" : "rgb(255, 255, 255)",
      );
      expect(tab.element().closest(".plan-pane-tab")!.getBoundingClientRect().width).toBe(236);
      expect(tab.element().getBoundingClientRect().height).toBe(32);
      expect(getComputedStyle(tab.element().querySelector("span")!).textOverflow).toBe("ellipsis");
      const header = pane.element().querySelector("header")!;
      expect(header.getBoundingClientRect().height).toBe(44);
      expect(getComputedStyle(pane.element()).outlineWidth).toBe("1px");
      document.documentElement.style.setProperty("--ui-font-size", "18px");
      expect(tab.element().getBoundingClientRect().height).toBe(32);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
      document.documentElement.style.removeProperty("--ui-font-size");
      for (const button of pane.element().querySelectorAll("button:not([role=tab])")) {
        expect(button.getBoundingClientRect().width).toBe(24);
        expect(getComputedStyle(button).cursor).toBe("pointer");
        expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth);
        expect(button.querySelector("svg")!.getBoundingClientRect().width).toBe(12);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    }
    await pane.getByRole("button", { name: "Copy plan", exact: true }).click();
    expect(copy).toHaveBeenLastCalledWith(plan.plan);
    await pane.getByRole("button", { name: "Download plan", exact: true }).click();
    const blob = created.mock.calls[0]![0];
    if (!(blob instanceof Blob)) throw new Error("Expected Markdown Blob");
    expect(await blob.text()).toBe(plan.plan);
    expect(downloads[0]!.name.endsWith(".md")).toBe(true);
    expect(revoked).toHaveBeenCalledWith("blob:plan");
    copy.mockRejectedValueOnce(new Error("denied"));
    await pane.getByRole("button", { name: "Copy plan", exact: true }).click();
    await expect
      .element(pane.getByRole("alert"))
      .toHaveTextContent("Could not copy plan. Try again.");
    created.mockImplementationOnce(() => {
      throw new Error("denied");
    });
    await pane.getByRole("button", { name: "Download plan", exact: true }).click();
    await expect
      .element(pane.getByRole("alert"))
      .toHaveTextContent("Could not download plan. Try again.");
  } finally {
    vi.restoreAllMocks();
    document.documentElement.classList.remove("dark");
    await screen.unmount();
  }
});

test("opening an overlay preserves Transcript reading and excludes pending permission shortcuts", async () => {
  await page.viewport(1440, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const send = async (facts: object) =>
    fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await screen.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
    await send({
      type: "snapshot",
      model: "test/script",
      compactions: [],
      toolStates: {},
      messages: [
        ...Array.from({ length: 25 }, (_, index) => [
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
            content: [{ type: "text", text: `Answer ${index}` }],
          },
        ]).flat(),
        {
          role: "assistant",
          timestamp: 100,
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
    });
    const feed = screen.getByRole("feed").element();
    await expect
      .element(screen.getByRole("region", { name: "Plan preview: Read safely" }))
      .toBeInTheDocument();
    feed.scrollTop = 0;
    await expect
      .element(screen.getByRole("button", { name: "Jump to latest", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("Answer 0", { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "Session summary", exact: true }).click();
    await screen
      .getByRole("complementary", { name: "Session summary" })
      .getByRole("button", { name: "Read safely", exact: true })
      .click();
    const pane = screen.getByRole("complementary", { name: "Plan side pane" });
    await expect.element(pane).toBeVisible();
    expect(screen.getByRole("feed").element()).toBe(feed);
    expect(feed.scrollTop).toBe(0);
    await pane.getByRole("button", { name: "Close side pane" }).click();
    await expect.element(pane).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Jump to response 10", exact: true }).click();
    await expect.element(screen.getByText("Answer 9", { exact: true })).toBeVisible();
    const middle = feed.scrollTop;
    expect(middle).toBeGreaterThan(0);
    await screen.getByRole("button", { name: "Session summary", exact: true }).click();
    await screen
      .getByRole("complementary", { name: "Session summary" })
      .getByRole("button", { name: "Read safely", exact: true })
      .click();
    await expect.element(pane).toBeVisible();
    expect(feed.scrollTop).toBe(middle);
    await pane.getByRole("button", { name: "Close side pane" }).click();
    await expect.element(pane).not.toBeInTheDocument();
    expect(feed.scrollTop).toBe(middle);
    await screen.getByRole("button", { name: "Jump to latest", exact: true }).click();
    await expect.poll(() => feed.scrollHeight - feed.scrollTop - feed.clientHeight).toBeLessThan(2);
    await screen
      .getByRole("region", { name: "Plan preview: Read safely" })
      .getByRole("button", { name: "Expand plan" })
      .click();
    await send({
      type: "message_update",
      message: {
        role: "assistant",
        timestamp: 101,
        content: [{ type: "text", text: "Streaming while the pane is open.\n\n".repeat(30) }],
      },
    });
    await expect.poll(() => feed.scrollHeight - feed.scrollTop - feed.clientHeight).toBeLessThan(2);
    await pane.getByRole("button", { name: "Close side pane" }).click();
    await expect.element(pane).not.toBeInTheDocument();
    await expect.poll(() => feed.scrollHeight - feed.scrollTop - feed.clientHeight).toBeLessThan(2);
    await screen.getByRole("button", { name: "Session summary", exact: true }).click();
    await screen
      .getByRole("complementary", { name: "Session summary" })
      .getByRole("button", { name: "Read safely", exact: true })
      .click();
    await expect.element(pane).toBeVisible();
    const identity = {
      epoch: "pending-pane",
      requestId: "pending-pane",
      taskId: 1,
      conversationId: 1,
    };
    await send({
      type: "interaction_requested",
      identity,
      request: {
        kind: "permission",
        identity,
        toolCallId: "perm",
        toolName: "bash",
        args: { command: "echo test" },
        mode: "ask",
        reason: "Read workspace",
        sessionAllow: { kind: "tool", rule: "bash" },
      },
    });
    await expect.element(screen.getByText("Read workspace", { exact: true })).toBeVisible();
    await page.viewport(420, 800);
    await expect
      .poll(() => document.querySelector("[data-conversation-frame]")?.hasAttribute("inert"))
      .toBe(true);
    await pane.getByRole("tab", { name: "Read safely" }).click();
    await expect.element(pane.getByRole("tab", { name: "Read safely" })).toHaveFocus();
    await screen.getByRole("button", { name: "Session summary", exact: true }).click();
    await expect.element(pane).not.toBeInTheDocument();
    const requestedSummary = screen.getByRole("complementary", {
      name: "Session summary",
      exact: true,
    });
    await expect.element(requestedSummary).toBeVisible();
    expect(document.querySelector("[data-conversation-frame]")?.hasAttribute("inert")).toBe(false);
    await requestedSummary.getByRole("button", { name: "Read safely", exact: true }).click();
    await expect.element(pane).toBeVisible();
    await expect.element(requestedSummary).not.toBeInTheDocument();
    await userEvent.keyboard("a{Escape}{Enter}{ArrowRight}");
    const wire = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(wire.filter((item: { type: string }) => item.type === "interaction.reply")).toEqual([]);
    expect(pane.element().getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    await pane.getByRole("button", { name: "Close side pane" }).click();
    await expect.element(pane).not.toBeInTheDocument();
    expect(document.querySelector("[data-conversation-frame]")?.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("feed").element()).toBe(feed);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
