import { expect, test, vi, onTestFinished } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "../../src/app";
import { NewChatSelector } from "../../src/app/new-chat-selector";
import { modelServicesFixture } from "../helpers/model-services";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import "../../src/theme.css";

async function fixture(port: number, action: string, value: unknown) {
  await fetch(`http://127.0.0.1:${port}/${action}`, {
    method: "POST",
    body: JSON.stringify(value),
  });
}
async function commands(port: number) {
  return (await (await fetch(`http://127.0.0.1:${port}/commands`)).json()) as {
    type: string;
    [key: string]: unknown;
  }[];
}

const copy = {
  en: {
    conversation: "Conversation",
    clear: "Clear project selection",
    searchProjects: "Search projects…",
    noProjects: "No matching projects",
    noProject: "Don’t use a project",
    searchBranches: "Search branches…",
    branch: (name: string) => `Current branch: ${name}`,
    worktree: (name: string) => `${name} · Independent worktree`,
    toggle: "Use an independent worktree",
    hint: "The next new Session will create an independent worktree from main without changing the primary folder.",
    create: "Create and check out new branch…",
    createNamed: (name: string) => `Create and check out ${name}`,
    createHint: "Type a new branch name in the search box.",
    prompt: "Prompt",
    send: "Send prompt",
    error: "Action failed: Could not create an independent worktree: git denied",
    gitError: "Git could not switch branches: local changes",
  },
  zh: {
    conversation: "对话",
    clear: "取消项目选择",
    searchProjects: "搜索项目…",
    noProjects: "没有匹配的项目",
    noProject: "不使用项目",
    searchBranches: "搜索分支…",
    branch: (name: string) => `当前分支：${name}`,
    worktree: (name: string) => `${name} · 独立工作树`,
    toggle: "使用独立工作树",
    hint: "下一个新会话将从 main 创建独立工作树，不影响主目录。",
    create: "创建并检出新分支…",
    createNamed: (name: string) => `创建并检出 ${name}`,
    createHint: "在搜索框中输入新分支名称。",
    prompt: "输入消息",
    send: "发送输入",
    error: "操作失败：无法创建独立工作树：git denied",
    gitError: "Git 无法切换分支：local changes",
  },
} as const;

test.each([
  { locale: "en", width: 1280, dark: false },
  { locale: "zh", width: 420, dark: true },
] as const)(
  "new chat selector follows M03 for Projects, branches and worktrees ($locale, $width)",
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
    document.documentElement.style.setProperty("--ui-font-size", "18px");
    onTestFinished(() => {
      document.documentElement.style.removeProperty("--ui-font-size");
    });
    const text = copy[locale];
    const main = screen.getByRole("main");
    const projectTrigger = main.getByRole("button", { name: text.conversation, exact: true });
    await expect.element(projectTrigger).toBeEnabled();
    expect(projectTrigger.element().getBoundingClientRect().height).toBe(32);
    expect(getComputedStyle(projectTrigger.element()).borderRadius).toBe("8px");
    expect(getComputedStyle(projectTrigger.element()).fontSize).toBe("18px");
    expect(getComputedStyle(projectTrigger.element()).cursor).toBe("pointer");
    for (const child of projectTrigger.element().querySelectorAll("svg, span"))
      expect(getComputedStyle(child).cursor).toBe("pointer");

    // C32: the bar shares the composer width and sits directly on top of it.
    const bar = document.querySelector<HTMLElement>(".new-chat-selector")!;
    const composer = document.querySelector<HTMLElement>(".conversation-composer")!;
    const barBox = bar.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    expect(barBox.height).toBe(40);
    expect(Math.abs(barBox.width - composerBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(barBox.left - composerBox.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(barBox.bottom - composerBox.top)).toBeLessThanOrEqual(1);
    expect(getComputedStyle(bar).borderTopLeftRadius).toBe("12px");
    expect(getComputedStyle(bar).borderBottomLeftRadius).toBe("0px");
    expect(getComputedStyle(composer).borderTopLeftRadius).not.toBe("0px");
    expect(main.getByRole("button", { name: text.branch("main"), exact: true }).query()).toBeNull();

    // C33: search, empty state and selection.
    await projectTrigger.click();
    const projectSearch = screen.getByRole("textbox", { name: text.searchProjects, exact: true });
    await expect.element(projectSearch).toHaveFocus();
    expect(screen.getByRole("menu").element().getBoundingClientRect().width).toBe(288);
    await userEvent.keyboard("zz");
    await expect.element(screen.getByText(text.noProjects, { exact: true })).toBeVisible();
    await userEvent.keyboard("{Backspace}{Backspace}proj");
    await expect.element(projectSearch).toHaveValue("proj");
    await screen.getByRole("menuitem", { name: "Project", exact: true }).click();
    const selected = main.getByRole("button", { name: "Project", exact: true });
    await expect.element(selected).toBeVisible();
    await selected.click();
    expect(
      screen
        .getByRole("menuitem", { name: "Project", exact: true })
        .element()
        .querySelector(".new-chat-mark svg"),
    ).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.element(selected).toHaveFocus();

    // C34: all local branches, search and switching.
    const branchTrigger = main.getByRole("button", { name: text.branch("main"), exact: true });
    expect(branchTrigger.element().getBoundingClientRect().height).toBe(32);
    const branchLabel = branchTrigger.element().querySelector("span")!;
    expect(branchLabel.getBoundingClientRect().width).toBeGreaterThan(24);
    expect(getComputedStyle(branchTrigger.element()).cursor).toBe("pointer");
    for (const child of branchTrigger.element().querySelectorAll("svg, span"))
      expect(getComputedStyle(child).cursor).toBe("pointer");
    await branchTrigger.click();
    const branchSearch = screen.getByRole("textbox", { name: text.searchBranches, exact: true });
    await expect.element(branchSearch).toHaveFocus();
    expect(screen.getByRole("menu").element().getBoundingClientRect().width).toBe(320);
    for (const name of ["dev/2026-0521", "main", "release/very-long-branch-name-for-truncation"])
      await expect.element(screen.getByRole("menuitem", { name, exact: true })).toBeVisible();
    await userEvent.keyboard("dev");
    await expect
      .element(screen.getByRole("menuitem", { name: "main", exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("menuitem", { name: "dev/2026-0521", exact: true }).click();
    const switched = main.getByRole("button", { name: text.branch("dev/2026-0521"), exact: true });
    await expect.element(switched).toBeVisible();

    // Creation uses the typed name; without one it explains what to do.
    await switched.click();
    await screen.getByRole("menuitem", { name: text.create, exact: true }).click();
    await expect.element(screen.getByText(text.createHint, { exact: true })).toBeVisible();
    await screen.getByRole("textbox", { name: text.searchBranches, exact: true }).fill("feat/x");
    await screen.getByRole("menuitem", { name: text.createNamed("feat/x"), exact: true }).click();
    const created = main.getByRole("button", { name: text.branch("feat/x"), exact: true });
    await expect.element(created).toBeVisible();

    // Git refusal keeps the menu open and reports the reason.
    await fixture(connection.port, "error", {
      type: "project.checkout",
      code: "git_failed",
      params: { message: "local changes" },
    });
    await created.click();
    await screen.getByRole("menuitem", { name: "main", exact: true }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent(text.gitError);
    await expect.element(screen.getByRole("menuitem", { name: "main", exact: true })).toBeVisible();

    // Worktree toggle echoes in the trigger and keeps the menu open.
    const toggle = screen.getByRole("menuitemcheckbox", { name: text.toggle, exact: true });
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");
    await expect
      .element(screen.getByText(text.hint.replace("main", "feat/x"), { exact: true }))
      .toBeVisible();
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      const box = menu.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(16);
      expect(box.right).toBeLessThanOrEqual(width - 16);
    }
    await userEvent.keyboard("{Escape}");
    const echoed = main.getByRole("button", {
      name: text.branch(text.worktree("feat/x")),
      exact: true,
    });
    await expect.element(echoed).toBeVisible();

    // Worktree creation failure keeps the selection and the prompt.
    await fixture(connection.port, "error", {
      type: "session.create",
      code: "worktree_failed",
      params: { message: "git denied" },
    });
    await main.getByRole("textbox", { name: text.prompt, exact: true }).fill("retained prompt");
    await screen.getByRole("button", { name: text.send, exact: true }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent(text.error);
    await expect.element(echoed).toBeVisible();
    expect(
      (await commands(connection.port))
        .filter((value) => value.type.startsWith("project.") || value.type === "session.create")
        .map(({ type, branch, worktree }) => ({ type, branch, worktree })),
    ).toEqual([
      { type: "project.git", branch: undefined, worktree: undefined },
      { type: "project.checkout", branch: "dev/2026-0521", worktree: undefined },
      { type: "project.createBranch", branch: "feat/x", worktree: undefined },
      { type: "project.checkout", branch: "main", worktree: undefined },
      { type: "session.create", branch: undefined, worktree: true },
    ]);

    // The x clears only this selection and returns to a conversation without a branch.
    const clear = main.getByRole("button", { name: text.clear, exact: true });
    expect(getComputedStyle(clear.element()).cursor).toBe("pointer");
    await clear.click();
    await expect
      .element(main.getByRole("button", { name: text.conversation, exact: true }))
      .toBeVisible();
    await expect.element(echoed).not.toBeInTheDocument();

    // Once a Session exists the selector is gone and the composer keeps its place.
    const before = document.querySelector(".conversation-composer")!.getBoundingClientRect();
    await main.getByRole("textbox", { name: text.prompt, exact: true }).fill("start");
    await screen.getByRole("button", { name: text.send, exact: true }).click();
    await expect.poll(() => document.querySelector(".new-chat-selector")).toBeNull();
    const after = document.querySelector(".conversation-composer")!.getBoundingClientRect();
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    document.documentElement.style.removeProperty("--ui-font-size");
  },
);

test("Don’t use a project resets the selection and hides the branch menu", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const main = screen.getByRole("main");
  await main.getByRole("button", { name: "Conversation", exact: true }).click();
  await screen.getByRole("menuitem", { name: "Project", exact: true }).click();
  await expect
    .element(main.getByRole("button", { name: "Current branch: main", exact: true }))
    .toBeVisible();
  await main.getByRole("button", { name: "Project", exact: true }).click();
  await screen.getByRole("menuitem", { name: "Don’t use a project", exact: true }).click();
  await expect
    .element(main.getByRole("button", { name: "Conversation", exact: true }))
    .toBeVisible();
  await expect
    .element(main.getByRole("button", { name: "Current branch: main", exact: true }))
    .not.toBeInTheDocument();
  await fixture(connection.port, "git", {
    repository: false,
    branch: null,
    head: "",
    branches: [],
  });
  await main.getByRole("button", { name: "Conversation", exact: true }).click();
  await screen.getByRole("menuitem", { name: "Project", exact: true }).click();
  await expect.element(main.getByRole("button", { name: "Project", exact: true })).toBeVisible();
  expect(document.querySelector(".new-chat-branch")).toBeNull();
});

test("disabled new chat choices preserve geometry and reject pointer and keyboard activation", async () => {
  const owner = ownProjectBrowserTest();
  const action = vi.fn();
  const project = {
    id: "project",
    name: "Project",
    directories: ["/project"],
    primary: "/project",
    trusted: true,
  };
  const screen = await owner.render(
    <div style={{ width: 388 }}>
      <NewChatSelector
        projects={[project]}
        target={project}
        git={{ repository: true, branch: "main", head: "abcdef", branches: ["main"] }}
        worktree={false}
        disabled
        onProject={action}
        onAddProject={action}
        onWorktree={action}
        onBranch={async () => {
          action();
          return null;
        }}
      />
    </div>,
  );
  try {
    for (const name of ["Clear project selection", "Project", "Current branch: main"]) {
      const button = screen.getByRole("button", { name, exact: true });
      await expect.element(button).toBeDisabled();
      expect(button.element().getBoundingClientRect().height).toBe(
        name === "Clear project selection" ? 24 : 32,
      );
      expect(getComputedStyle(button.element()).opacity).toBe("0.5");
      for (const child of [button.element(), ...button.element().querySelectorAll("svg,span")])
        expect(getComputedStyle(child).cursor).toBe("not-allowed");
      await button.click({ force: true });
      button.element().focus();
      await userEvent.keyboard("{Enter}{Space}");
    }
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("menu").query()).toBeNull();
  } finally {
    await owner.close();
  }
});
