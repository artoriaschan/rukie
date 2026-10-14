import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import "../../src/theme.css";

async function fixture(port: number, action: string, value: unknown) {
  await fetch(`http://127.0.0.1:${port}/${action}`, {
    method: "POST",
    body: JSON.stringify(value),
  });
}

test.each([
  { locale: "en", width: 1280, dark: false },
  { locale: "zh", width: 420, dark: true },
] as const)(
  "new Git Project chat preserves layout and worktree selection after failure ($locale, $width)",
  async ({ locale, width, dark }) => {
    const owner = ownProjectBrowserTest();
    const connection = await owner.startWire();
    await page.viewport(width, 900);
    document.documentElement.classList.toggle("dark", dark);
    const screen = await owner.render(
      <App
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
        locale={locale}
      />,
    );
    const text =
      locale === "en"
        ? {
            workspace: "Workspace",
            branch: "Current branch: main",
            toggle: "Use an independent worktree",
            hint: "The next new Session will create an independent worktree from main without changing the primary folder.",
            send: "Send prompt",
            error: "Action failed: Could not create an independent worktree: git denied",
          }
        : {
            workspace: "默认工作区",
            branch: "当前分支：main",
            toggle: "使用独立工作树",
            hint: "下一个新会话将从 main 创建独立工作树，不影响主目录。",
            send: "发送输入",
            error: "操作失败：无法创建独立工作树：git denied",
          };
    await expect
      .element(screen.getByRole("button", { name: text.workspace, exact: true }).last())
      .toBeEnabled();
    await screen.getByRole("button", { name: text.workspace, exact: true }).last().click();
    await screen.getByRole("menuitem", { name: "Project", exact: true }).click();
    const trigger = screen.getByRole("button", { name: text.branch, exact: true });
    await expect.element(trigger).toBeVisible();
    const regions = [
      screen.getByRole("main").element(),
      screen.getByRole("banner").element(),
      screen.getByRole("textbox").element(),
    ];
    const baseline = regions.map((element) => element.getBoundingClientRect());
    await trigger.click();
    const toggle = screen.getByRole("menuitemcheckbox", { name: text.toggle, exact: true });
    await expect.element(toggle).toHaveAttribute("aria-checked", "false");
    toggle.element().focus();
    await userEvent.keyboard("{Space}");
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");
    await expect.element(screen.getByText(text.hint, { exact: true })).toBeVisible();
    expect(getComputedStyle(toggle.element()).cursor).toBe("pointer");
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      const box = menu.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
    regions.forEach((element, index) => {
      const box = element.getBoundingClientRect();
      for (const key of ["x", "y", "width", "height"] as const)
        expect(Math.abs(box[key] - baseline[index]![key])).toBeLessThanOrEqual(1);
    });
    await userEvent.keyboard("{Escape}");
    await fixture(connection.port, "error", {
      type: "session.create",
      code: "worktree_failed",
      params: { message: "git denied" },
    });
    await screen.getByRole("textbox").fill("retained prompt");
    await screen.getByRole("button", { name: text.send, exact: true }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent(text.error);
    await expect.element(screen.getByRole("textbox")).toHaveValue("retained prompt");
    await trigger.click();
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Escape}");
    const commands = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(
      commands.filter((value: { type: string }) => value.type === "session.create"),
    ).toMatchObject([{ project: "project", worktree: true, text: "retained prompt" }]);
    await fixture(connection.port, "git", { repository: false, branch: null, head: "" });
    await fixture(connection.port, "message", {
      type: "sessions_changed",
      homeDir: "/fixture-home",
      sessions: [],
      projects: [
        {
          id: "project",
          name: "Project",
          primary: "/not-git",
          directories: ["/not-git"],
          trusted: true,
        },
      ],
      pinned: [],
      archived: [],
      preferences: {},
    });
    await expect.element(trigger).not.toBeInTheDocument();
  },
);
