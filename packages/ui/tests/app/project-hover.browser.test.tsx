import { expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import { App } from "../../src/app";
import { act } from "react";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test("Project keyboard detail preserves disclosure and opens the shared editor", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  await commands.reducedMotion(true);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    const row = screen
      .getByRole("region", { name: "Projects", exact: true })
      .getByRole("button", { name: "Project", exact: true });
    await expect.element(row).toBeVisible();
    row.element().focus();
    const card = screen.getByRole("dialog", { name: "Project details", exact: true });
    await expect.element(card).toBeVisible();
    expect(row.element().getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(card.getByRole("button", { name: "Pin details", exact: true }))
      .toHaveFocus();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      card
        .element()
        .dispatchEvent(
          new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", pointerId: 1 }),
        );
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(card.element().closest("[inert]")).toBeNull();
    vi.useRealTimers();
    await userEvent.keyboard("{Escape}");
    await expect.element(card).not.toBeInTheDocument();
    await expect.element(row).toHaveFocus();
    row.element().blur();
    row.element().focus();
    await expect.element(card).toBeVisible();
    await card.getByRole("button", { name: "Edit project", exact: true }).click();
    await expect.element(card).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("dialog", { name: "Edit project", exact: true }))
      .toBeVisible();
  } finally {
    await owner.close();
  }
});

test.each([
  { width: 1280, dark: false },
  { width: 420, dark: true },
])("Project detail count, paths, selected row and geometry at $width", async ({ width, dark }) => {
  const owner = ownProjectBrowserTest();
  await page.viewport(width, 700);
  await commands.reducedMotion(true);
  document.documentElement.classList.toggle("dark", dark);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale={dark ? "zh" : "en"}
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    const toggle = screen.getByRole("button", {
      name: dark ? "切换侧栏" : "Toggle sidebar",
      exact: true,
    });
    await expect.element(toggle).toBeVisible();
    if (toggle.element().getAttribute("aria-pressed") !== "true") await toggle.click();
    await expect
      .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    const session = {
      id: "one",
      title: "In project",
      titleSource: "prompt",
      cwd: "/custom/home/repo",
      projectId: "project",
      worktree: null,
      model: "test/script",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
    };
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify({
        type: "sessions_changed",
        homeDir: "/custom/home",
        sessions: [
          session,
          { ...session, id: "two", title: "Pinned", cwd: "/other" },
          { ...session, id: "archived" },
        ],
        projects: [
          {
            id: "project",
            name: "Project",
            directories: ["/custom/home/repo", "/custom/home-other/repo", "/other"],
            primary: "/custom/home/repo",
            trusted: true,
          },
        ],
        pinned: ["two"],
        archived: ["archived"],
        preferences: {},
      }),
    });
    const disclosure = screen
      .getByRole("region", { name: dark ? "项目" : "Projects", exact: true })
      .getByRole("button", { name: "Project", exact: true });
    await expect
      .element(screen.getByRole("button", { name: "In project", exact: true }))
      .toBeVisible();
    const row = disclosure.element().parentElement!;
    const newChat = row.querySelector<HTMLButtonElement>("button[aria-label]")!;
    const beforePlus = newChat.getBoundingClientRect();
    const shell = [
      ...document.querySelectorAll<HTMLElement>(
        ".app-titlebar, .app-workspace, .app-session-sidebar, main",
      ),
    ];
    const baseline = shell.map((element) => element.getBoundingClientRect());
    const color = getComputedStyle(row).backgroundColor;
    expect(row.getBoundingClientRect().height).toBe(32);
    expect(getComputedStyle(row).borderRadius).toBe("8px");
    expect(getComputedStyle(newChat).opacity).toBe("0");
    await disclosure.hover();
    expect(getComputedStyle(row).backgroundColor).not.toBe(color);
    expect(getComputedStyle(newChat).opacity).toBe("1");
    expect(newChat.getBoundingClientRect().x).toBe(beforePlus.x);
    expect([beforePlus.width, beforePlus.height]).toEqual([24, 24]);
    expect(getComputedStyle(newChat).borderRadius).toBe("6px");
    expect(newChat.querySelector("svg")!.getBoundingClientRect().width).toBe(12);
    const rowHover = getComputedStyle(row).backgroundColor;
    await page.elementLocator(newChat).hover();
    expect(getComputedStyle(row).backgroundColor).toBe(color);
    expect(getComputedStyle(newChat).backgroundColor).toBe(rowHover);
    await disclosure.hover();
    expect(getComputedStyle(row).backgroundColor).toBe(rowHover);
    expect(row.querySelector('[aria-label^="More"]')).toBeNull();
    disclosure.element().focus();
    const card = screen.getByRole("dialog", {
      name: dark ? "项目详情" : "Project details",
      exact: true,
    });
    await expect.element(card).toBeVisible();
    await expect
      .element(card.getByText(dark ? "2 个会话" : "Sessions: 2", { exact: true }))
      .toBeVisible();
    for (const path of ["~/repo", "/custom/home-other/repo", "/other"])
      await expect.element(card.getByText(path, { exact: true })).toBeVisible();
    const box = card.element().getBoundingClientRect();
    const anchor = row.getBoundingClientRect();
    expect(box.width).toBe(320);
    expect(getComputedStyle(card.element()).padding).toBe("0px");
    expect(getComputedStyle(card.element()).borderRadius).toBe("12px");
    const separators = card.element().querySelectorAll('[role="separator"]');
    expect(separators).toHaveLength(2);
    const inner = card.element().clientLeft;
    const rows = [...card.element().children].map((child) => ({
      separator: child.getAttribute("role") === "separator",
      line: child.getBoundingClientRect(),
    }));
    // 6px everywhere: shell edge to first/last row, between rows and around separators.
    expect(rows[0]!.line.top - (box.top + inner)).toBeCloseTo(6, 0);
    expect(box.bottom - inner - rows.at(-1)!.line.bottom).toBeCloseTo(6, 0);
    for (let index = 1; index < rows.length; index++)
      expect(rows[index]!.line.top - rows[index - 1]!.line.bottom).toBeCloseTo(6, 0);
    for (const { separator, line } of rows) {
      if (separator) {
        expect(line.height).toBe(1);
        expect(line.left).toBeCloseTo(box.left + inner, 0);
        expect(line.right).toBeCloseTo(box.right - inner, 0);
      } else {
        expect(line.left).toBeCloseTo(box.left + inner + 6, 0);
        expect(line.right).toBeCloseTo(box.right - inner - 6, 0);
      }
    }
    expect(card.element().scrollWidth).toBe(card.element().clientWidth);
    expect(
      card
        .getByRole("button", { name: dark ? "固定详情" : "Pin details", exact: true })
        .element()
        .getBoundingClientRect().height,
    ).toBe(24);
    expect(card.element().closest('[data-slot="scroll-area-viewport"]')).toBeNull();
    expect(box.right).toBeLessThanOrEqual(width - 8);
    expect(box.top).toBeGreaterThanOrEqual(8);
    if (width === 1280) {
      expect(box.left - anchor.right).toBeCloseTo(4, 0);
      expect(box.top).toBeCloseTo(anchor.top, 0);
    }
    for (const [i, element] of shell.entries())
      for (const key of ["x", "y", "width", "height"] as const)
        expect(element.getBoundingClientRect()[key]).toBeCloseTo(baseline[i]![key], 0);
    await userEvent.keyboard("{Escape}");
    await screen.getByRole("button", { name: "In project", exact: true }).click();
    if (toggle.element().getAttribute("aria-pressed") !== "true") await toggle.click();
    await expect
      .element(screen.getByRole("button", { name: "In project", exact: true }))
      .toHaveAttribute("aria-current", "page");
    // The narrow sidebar toggle keeps keyboard focus and its readable hint open.
    // Dismiss that hint through its public Escape action before moving off the Project.
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("tooltip")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: dark ? "新聊天" : "New chat", exact: true }).hover();
    const selected = disclosure.element().parentElement!;
    expect(getComputedStyle(selected).backgroundColor).not.toBe(color);
  } finally {
    await owner.close();
  }
});

test("fixed Project detail survives another Project intent and App transitions suspend the portal", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  await commands.reducedMotion(true);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    await expect
      .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify({
        type: "sessions_changed",
        homeDir: "/fixture-home",
        sessions: [],
        projects: [
          { id: "a", name: "Alpha", directories: ["/a"], primary: "/a", trusted: true },
          { id: "b", name: "Beta", directories: ["/b"], primary: "/b", trusted: true },
        ],
        pinned: [],
        archived: [],
        preferences: {},
      }),
    });
    const alpha = screen
      .getByRole("region", { name: "Projects", exact: true })
      .getByRole("button", { name: "Alpha", exact: true });
    const beta = screen
      .getByRole("region", { name: "Projects", exact: true })
      .getByRole("button", { name: "Beta", exact: true });
    await expect.element(alpha).toBeVisible();
    alpha.element().focus();
    let card = screen.getByRole("dialog", { name: "Project details", exact: true });
    await expect.element(card).toBeVisible();
    await card.getByRole("button", { name: "Pin details", exact: true }).click();
    beta.element().focus();
    await beta.hover();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(card.element().textContent).toContain("Alpha");
    expect(card.element().textContent).not.toContain("Beta");
    expect(
      card
        .getByRole("button", { name: "Unpin details", exact: true })
        .element()
        .getAttribute("aria-pressed"),
    ).toBe("true");
    vi.useRealTimers();
    await userEvent.keyboard("{Escape}");
    await expect.element(card).not.toBeInTheDocument();
    // A new explicit keyboard intent can reopen after Escape without moving focus.
    await userEvent.keyboard("{ArrowRight}");
    card = screen.getByRole("dialog", { name: "Project details", exact: true });
    await expect.element(card).toBeVisible();
    await expect
      .element(card.getByRole("button", { name: "Pin details", exact: true }))
      .toHaveFocus();
    expect(card.element().textContent).toContain("Beta");
    await screen.getByRole("textbox", { name: "Prompt", exact: true }).click();
    await expect.element(card).not.toBeInTheDocument();
    alpha.element().focus();
    await expect.element(card).toBeVisible();
    await card.getByRole("button", { name: "Pin details", exact: true }).click();
    await screen.getByRole("button", { name: "New chat", exact: true }).click();
    await expect.element(card).not.toBeInTheDocument();
    const alphaRow = alpha.element().parentElement!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      alphaRow.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, pointerType: "touch", pointerId: 2 }),
      );
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(
      document.querySelector('[aria-label="Project details"]:not([aria-hidden="true"])'),
    ).toBeNull();
    await act(() => {
      alphaRow.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, pointerType: "touch", pointerId: 2 }),
      );
      alphaRow.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", pointerId: 1 }),
      );
    });
    vi.useRealTimers();
    await screen.getByRole("button", { name: "New chat", exact: true }).click();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(
      document.querySelector('[aria-label="Project details"]:not([aria-hidden="true"])'),
    ).toBeNull();
    vi.useRealTimers();
    alpha.element().focus();
    await expect.element(card).toBeVisible();
    // Keyboard activation opens the App settings without an outside pointer dismissal.
    screen.getByRole("button", { name: "Model services", exact: true }).element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(card).not.toBeInTheDocument();
  } finally {
    await owner.close();
  }
});

test("long Project paths wrap, remain selectable and scroll within the viewport", async () => {
  const owner = ownProjectBrowserTest();
  await page.viewport(600, 420);
  await commands.reducedMotion(true);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale="en"
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  try {
    await expect
      .element(screen.getByRole("button", { name: "Toggle sidebar", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
    const directories = Array.from(
      { length: 18 },
      (_, index) => `/fixture-home/${"long-folder/".repeat(10)}repository-${index}`,
    );
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify({
        type: "sessions_changed",
        homeDir: "/fixture-home",
        sessions: [],
        projects: [
          { id: "long", name: "Long project", directories, primary: directories[0], trusted: true },
        ],
        pinned: [],
        archived: [],
        preferences: {},
      }),
    });
    const row = screen.getByRole("button", { name: "Long project", exact: true });
    await expect.element(row).toBeVisible();
    row.element().focus();
    const card = screen.getByRole("dialog", { name: "Project details", exact: true });
    await expect.element(card).toBeVisible();
    const box = card.element().getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.bottom).toBeLessThanOrEqual(412);
    expect(box.right).toBeLessThanOrEqual(592);
    expect(card.element().scrollHeight).toBeGreaterThan(card.element().clientHeight);
    const path = card
      .getByText(`~/${"long-folder/".repeat(10)}repository-0`, { exact: true })
      .element();
    expect(getComputedStyle(path).userSelect).toBe("text");
    expect(path.getBoundingClientRect().height).toBeGreaterThan(20);
    card.element().scrollTop = card.element().scrollHeight;
    await expect
      .element(card.getByRole("button", { name: "Edit project", exact: true }))
      .toBeVisible();
  } finally {
    await owner.close();
  }
});

test.each(["light", "dark"] as const)(
  "%s Project hover is immediate at exact intent deadlines and retains the measured pointer corridor",
  async (theme) => {
    const owner = ownProjectBrowserTest();
    await page.viewport(1280, 900);
    await commands.reducedMotion(false);
    document.documentElement.className = theme;
    const connection = await owner.startWire();
    const screen = await owner.render(
      <App
        locale="en"
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      />,
    );
    try {
      const disclosure = screen
        .getByRole("region", { name: "Projects", exact: true })
        .getByRole("button", { name: "Project", exact: true });
      await expect.element(disclosure).toBeVisible();
      const row = disclosure.element().parentElement!;
      const card = document.querySelector<HTMLElement>('[aria-label="Project details"]')!;
      const event = (element: Element | Window, type: string, point = { clientX: 0, clientY: 0 }) =>
        act(() => {
          element.dispatchEvent(
            new PointerEvent(type, { bubbles: true, pointerType: "mouse", pointerId: 1, ...point }),
          );
        });
      const visible = () => getComputedStyle(card).visibility !== "hidden";
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const tick = async (time: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(time);
        });
      await event(row, "pointerover");
      await tick(299);
      expect(visible()).toBe(false);
      await event(row, "pointerout");
      await tick(1);
      expect(visible()).toBe(false);
      await event(row, "pointerover");
      await tick(299);
      expect(visible()).toBe(false);
      await tick(1);
      expect(visible()).toBe(true);
      const panel = card.parentElement!;
      expect(getComputedStyle(panel).clipPath).toBe("none");
      expect(panel.getAnimations({ subtree: true })).toHaveLength(0);
      const shown = card.getBoundingClientRect();
      expect(shown.width).toBe(320);
      const anchor = row.getBoundingClientRect();
      expect(shown.left - anchor.right).toBeCloseTo(4, 0);
      expect(shown.top).toBeCloseTo(anchor.top, 0);
      await event(row, "pointerout");
      await event(window, "pointermove", { clientX: anchor.right + 2, clientY: anchor.top + 16 });
      await tick(151);
      expect(visible()).toBe(true);
      await event(card, "pointerover");
      await event(card, "pointerout");
      await event(window, "pointermove", { clientX: 1200, clientY: 800 });
      await tick(149);
      expect(visible()).toBe(true);
      await tick(1);
      expect(visible()).toBe(false);
      await event(row, "pointerover");
      await tick(300);
      await event(row, "pointerout");
      await tick(100);
      await event(row, "pointerover");
      await tick(50);
      expect(visible()).toBe(true);
      vi.useRealTimers();
      const pin = screen
        .getByRole("dialog", { name: "Project details", exact: true })
        .getByRole("button", { name: "Pin details", exact: true });
      await pin.click();
      await expect
        .element(screen.getByRole("button", { name: "Unpin details", exact: true }))
        .toHaveAttribute("aria-pressed", "true");
      // Move keyboard focus out too: pin persistence must not rely on focus retention.
      screen.getByRole("textbox", { name: "Prompt", exact: true }).element().focus();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await event(card, "pointerout");
      await event(window, "pointermove", { clientX: 1200, clientY: 800 });
      await tick(150);
      expect(visible()).toBe(true);
      vi.useRealTimers();
      await screen.getByRole("button", { name: "Unpin details", exact: true }).click();
      expect(visible()).toBe(false);
      await expect.element(disclosure).toHaveFocus();
    } finally {
      await owner.close();
    }
  },
);
