import { useState } from "react";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PromptInput } from "../../src/components/agents/prompt-input";
import { Composer } from "../../src/components/composer";
import "../../src/theme.css";

const skills = [
  {
    name: "review",
    description: "Review changes",
    scope: "project" as const,
    filePath: "/project/.agents/skills/review/SKILL.md",
  },
];
function Fixture({
  running = false,
  goalDisabledReason,
  onGoal = vi.fn(),
}: {
  running?: boolean;
  goalDisabledReason?: string;
  onGoal?: () => void;
}) {
  const [draft, setDraft] = useState("Keep this body");
  const [plan, setPlan] = useState(false);
  return (
    <Composer
      draft={draft}
      onDraft={setDraft}
      skills={skills}
      images={[]}
      onImages={vi.fn()}
      disabled={false}
      running={running}
      permissionMode="ask"
      onPermission={vi.fn()}
      planMode={plan}
      onPlanMode={setPlan}
      models={[]}
      onModel={vi.fn()}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onGoal={onGoal}
      goalDisabledReason={goalDisabledReason}
    />
  );
}

test("plus shares grouped insertion, preserves the body and composer geometry", async () => {
  await page.viewport(1280, 900);
  const screen = await render(
    <div style={{ width: 752, marginTop: 400 }}>
      <Fixture />
    </div>,
  );
  try {
    const input = screen.getByRole("combobox", { name: "Prompt", exact: true });
    const form = input.element().closest("form")!;
    const baseline = form.getBoundingClientRect().toJSON();
    await screen.getByRole("button", { name: "Attach images", exact: true }).click();
    await expect.element(input).toHaveFocus();
    await expect.element(screen.getByRole("group", { name: "Add", exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("group", { name: "Built-in commands", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByRole("group", { name: "Skills", exact: true })).toBeVisible();
    const panel = screen.getByRole("dialog", { name: "Insert", exact: true }).element();
    expect(panel.getBoundingClientRect().width).toBe(752);
    expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      form.getBoundingClientRect().top,
    );
    expect(form.getBoundingClientRect().toJSON()).toEqual(baseline);
    await screen
      .getByRole("option", { name: "review Review changes Project", exact: true })
      .click();
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveTextContent("review Keep this body");
    expect(input.element().querySelectorAll("[data-skill-token]").length).toBe(1);
    await screen.getByRole("button", { name: "Attach images", exact: true }).click();
    await screen
      .getByRole("option", { name: "review Review changes Project", exact: true })
      .click();
    await expect.element(input).toHaveTextContent("review Keep this body");
    expect(input.element().querySelectorAll("[data-skill-token]").length).toBe(1);
  } finally {
    await screen.unmount();
  }
});

test("builtins filter by command name, keep draft unchanged and stay usable during a Run", async () => {
  const goal = vi.fn();
  const screen = await render(
    <div style={{ width: 752, marginTop: 400 }}>
      <Fixture running onGoal={goal} />
    </div>,
  );
  try {
    const input = screen.getByRole("combobox", { name: "Prompt", exact: true });
    const add = screen.getByRole("button", { name: "Attach images", exact: true });
    await input.fill("");
    await add.click();
    await expect.element(input).toHaveFocus();
    await expect
      .element(screen.getByRole("option", { name: "/plan Plan mode Off", exact: true }))
      .toBeVisible();
    await userEvent.keyboard("/PL");
    await expect
      .element(screen.getByRole("group", { name: "Add", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("group", { name: "Skills", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(input).toHaveAttribute("aria-expanded", "true");
    const option = screen.getByRole("option", { name: "/plan Plan mode Off", exact: true });
    expect(input.element().getAttribute("aria-activedescendant")).toBe(option.element().id);
    await userEvent.keyboard("{Tab}");
    await expect.element(input).toHaveTextContent("/PL");
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(screen.getByRole("button", { name: "Close plan mode", exact: true }))
      .toBeVisible();
    await add.click();
    await screen.getByRole("option", { name: "/goal Goal mode Off", exact: true }).click();
    expect(goal).toHaveBeenCalledOnce();
    await expect.element(input).toHaveTextContent("/PL");
    await input.fill("/");
    await expect
      .element(screen.getByRole("group", { name: "Built-in commands", exact: true }))
      .toBeVisible();
    const options = screen.getByRole("option").all();
    expect(options.map((item) => item.element().textContent)).toEqual([
      "/goalContinue until the goal is complete or blocked",
      "/mcpView MCP server statusLoading",
      "/planPlan mode• On",
      "reviewReview changesProject",
    ]);
  } finally {
    await screen.unmount();
  }
});

test("unavailable goal is described and rejects pointer and keyboard activation", async () => {
  const goal = vi.fn();
  const screen = await render(
    <div style={{ width: 752, marginTop: 400 }}>
      <Fixture goalDisabledReason="Wait for the active Run" onGoal={goal} />
    </div>,
  );
  try {
    const input = screen.getByRole("combobox", { name: "Prompt", exact: true });
    await input.fill("/goal");
    const option = screen.getByRole("option", { name: "/goal Goal mode Off", exact: true });
    await expect.element(option).toHaveAttribute("aria-disabled", "true");
    expect(option.element().querySelector("[title]")?.getAttribute("title")).toBe(
      "Wait for the active Run",
    );
    expect(getComputedStyle(option.element()).cursor).toBe("not-allowed");
    expect(getComputedStyle(option.element().querySelector("svg")!).cursor).toBe("not-allowed");
    await option.click({ force: true });
    await userEvent.keyboard("{Enter}{Tab}");
    expect(goal).not.toHaveBeenCalled();
    await expect.element(input).toHaveTextContent("/goal");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
  } finally {
    await screen.unmount();
  }
});

test("ordinary typing dismisses plus and attachment selection invokes the existing input", async () => {
  const screen = await render(
    <div style={{ width: 752, marginTop: 400 }}>
      <Fixture />
    </div>,
  );
  try {
    const input = screen.getByRole("combobox", { name: "Prompt", exact: true });
    const add = screen.getByRole("button", { name: "Attach images", exact: true });
    await input.click();
    await userEvent.keyboard("{End}");
    await add.click();
    await userEvent.keyboard("x");
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
    await expect.element(input).toHaveTextContent("Keep this bodyx");
    const clicked = vi.fn((event: Event) => event.preventDefault());
    document
      .querySelector<HTMLInputElement>("input[type=file]")!
      .addEventListener("click", clicked);
    await add.click();
    const attachment = screen.getByRole("option", { name: "Attach images", exact: true });
    expect(getComputedStyle(attachment.element()).cursor).toBe("pointer");
    expect(getComputedStyle(attachment.element().querySelector("svg")!).cursor).toBe("pointer");
    await userEvent.keyboard("{Enter}");
    expect(clicked).toHaveBeenCalledOnce();
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
    await expect.element(input).toHaveTextContent("Keep this bodyx");
    await expect.element(input).toHaveFocus();
  } finally {
    await screen.unmount();
  }
});

test("plus resets slash filtering and refreshes each entry while keeping cached rows", async () => {
  const opened = vi.fn();
  const screen = await render(
    <div style={{ width: 752, marginTop: 400 }}>
      <PromptInput
        skills={[...skills, { ...skills[0]!, name: "build" }]}
        onSkillsOpen={opened}
        insertionActions={[
          { name: "Attach images", label: "Attach images", group: "add", onSelect: vi.fn() },
        ]}
      />
    </div>,
  );
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/r");
    await expect
      .element(screen.getByRole("option", { name: "review Review changes Project" }))
      .toBeVisible();
    expect(opened).toHaveBeenCalledTimes(1);
    await screen.getByRole("button", { name: "Add to prompt", exact: true }).click();
    await expect.poll(() => screen.getByRole("option").all().length).toBe(3);
    expect(
      screen
        .getByRole("option")
        .all()
        .map((row) => row.element().getAttribute("aria-label")),
    ).toEqual(["Attach images", "build Review changes Project", "review Review changes Project"]);
    expect(opened).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{Escape}");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
    await screen.getByRole("button", { name: "Add to prompt", exact: true }).click();
    await expect
      .element(screen.getByRole("option", { name: "build Review changes Project" }))
      .toBeVisible();
    expect(opened).toHaveBeenCalledTimes(3);
  } finally {
    await screen.unmount();
  }
});

test("removing the token separator keeps the list closed and sends the selected skill", async () => {
  const sent = vi.fn();
  const screen = await render(
    <div style={{ width: 752, marginTop: 400 }}>
      <PromptInput skills={skills} onSubmit={sent} />
    </div>,
  );
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/r");
    await userEvent.keyboard("{Tab}{Backspace}");
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{Enter}");
    expect(sent).toHaveBeenCalledWith("/review", undefined);
  } finally {
    await screen.unmount();
  }
});
