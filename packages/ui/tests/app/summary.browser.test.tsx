import { expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Summary } from "../../src/components/conversation-dock";
import { UiLocaleProvider } from "../../src/lib/i18n";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test("restored Summary shows C41 cards in order without moving shell or composer", async () => {
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
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "snapshot",
        sessionId: "one",
        model: "test/script",
        compactions: [],
        messages: [
          { role: "user", timestamp: 1, entryId: "u", content: "Plan a migration" },
          ...["Previous plan", "Latest restored plan with a very long title ".repeat(6)].map(
            (title, index) => ({
              role: "assistant",
              timestamp: index + 2,
              entryId: `a${index}`,
              content: [
                {
                  type: "toolCall",
                  id: "reused",
                  name: "exit_plan_mode",
                  arguments: { plan: `# ${title}\n\nKeep all data.` },
                },
              ],
            }),
          ),
        ],
        toolStates: {
          todo: [
            { content: "Keep data", status: "completed" },
            { content: "Verify migration", status: "in_progress" },
            { content: "Ship migration", status: "pending" },
          ],
          subagents: [
            {
              id: "child",
              description: "Check migration",
              type: "general",
              active: false,
              latestRun: { outcome: "error" },
            },
          ],
        },
      }),
    });
    const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await expect.element(prompt).toBeVisible();
    const composer = prompt.element().closest("form")!;
    const shell = document.querySelector(".app-workspace")!;
    const rect = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const before = { composer: rect(composer), shell: rect(shell) };
    const toggle = screen.getByRole("button", { name: "Session summary", exact: true });
    await toggle.click();
    const summary = screen.getByRole("complementary", { name: "Session summary", exact: true });
    await expect.element(summary).toBeVisible();
    const cards = Array.from(summary.element().querySelectorAll("section"));
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual([
      "Tasks",
      "Subagents",
      "Plan",
    ]);
    expect(summary.element().getBoundingClientRect().width).toBe(300);
    expect(getComputedStyle(summary.element()).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(summary.element()).gap).toBe("12px");
    expect(summary.element().querySelector("h2")).toBeNull();
    expect(summary.element().querySelector("[aria-expanded]")).toBeNull();
    for (const card of cards) {
      expect(getComputedStyle(card).borderRadius).toBe("16px");
      const rows = Array.from(card.querySelectorAll("li,button"));
      expect(rows[0]!.getBoundingClientRect().top - card.getBoundingClientRect().top).toBe(45);
      for (const row of rows) {
        expect(row.getBoundingClientRect().height).toBe(32);
        expect(getComputedStyle(row.querySelector("svg")!).width).toBe("12px");
        expect(row.querySelector("svg")!.parentElement!.getBoundingClientRect().width).toBe(14);
      }
    }
    const plan = summary.getByRole("button", { name: /^Latest restored plan/ });
    expect(getComputedStyle(plan.element().querySelector(".truncate")!).textOverflow).toBe(
      "ellipsis",
    );
    expect(rect(composer)).toEqual(before.composer);
    expect(rect(shell)).toEqual(before.shell);
    await expect.element(toggle).toHaveFocus();
    await plan.click();
    await expect.element(summary).not.toBeInTheDocument();
    const pane = screen.getByRole("complementary", { name: "Plan side pane", exact: true });
    await expect.element(pane).toBeVisible();
    const withPane = rect(composer);
    await toggle.click();
    await expect.element(summary).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(summary).not.toBeInTheDocument();
    await expect.element(pane).toBeVisible();
    expect(rect(composer)).toEqual(withPane);
    await pane.getByRole("button", { name: "Close side pane" }).click();
    await expect.element(pane).not.toBeInTheDocument();
    expect(rect(composer)).toEqual(before.composer);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("Summary hides empty cards and its plan row supports both themes, narrow bounds and keyboard opening", async () => {
  await page.viewport(480, 800);
  const onOpenPlan = vi.fn();
  const plan = {
    id: "submission:2",
    toolId: "reused",
    title: "A long restored plan ".repeat(12),
    plan: "# A plan",
  };
  const content = (withPlan: boolean) => (
    <UiLocaleProvider locale="zh">
      <div style={{ position: "relative", width: "100%", height: 500 }}>
        <Summary
          toolStates={{ todo: [{ content: "invalid", status: "invalid" }] }}
          background={[]}
          plan={withPlan ? plan : undefined}
          onOpenPlan={onOpenPlan}
        />
      </div>
    </UiLocaleProvider>
  );
  const screen = await render(content(false));
  try {
    const summary = screen.getByRole("complementary", { name: "会话摘要" });
    expect(summary.element().querySelectorAll("section")).toHaveLength(0);
    await screen.rerender(content(true));
    const button = summary.getByRole("button", { name: plan.title });
    for (const theme of ["light", "dark"]) {
      document.documentElement.classList.toggle("dark", theme === "dark");
      const card = summary.getByRole("region", { name: "计划", exact: true }).element();
      expect(getComputedStyle(card).backgroundColor).toBe(
        theme === "dark" ? "rgb(43, 43, 43)" : "rgb(255, 255, 255)",
      );
      expect(summary.element().getBoundingClientRect().width).toBe(300);
      const resting = getComputedStyle(button.element()).backgroundColor;
      await button.hover();
      expect(getComputedStyle(button.element()).backgroundColor).not.toBe(resting);
      expect(getComputedStyle(button.element()).cursor).toBe("pointer");
      expect(getComputedStyle(button.element().querySelector("svg")!).width).toBe("12px");
      await userEvent.tab();
      await expect.element(button).toHaveFocus();
      expect(getComputedStyle(button.element()).boxShadow).not.toBe("none");
      await userEvent.keyboard("{Enter}");
      expect(onOpenPlan).toHaveBeenLastCalledWith(plan);
      button.element().blur();
      await page.viewport(280, 700);
      expect(summary.element().getBoundingClientRect().width).toBe(248);
      expect(summary.element().getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth - 16);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
      await page.viewport(480, 800);
      await userEvent.click(document.body);
    }
  } finally {
    document.documentElement.classList.remove("dark");
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});
