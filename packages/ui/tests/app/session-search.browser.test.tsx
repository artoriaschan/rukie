import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

async function wireCommands(port: number): Promise<unknown> {
  return (await fetch(`http://127.0.0.1:${port}/commands`)).json();
}

test("search lists every unarchived chat in updated order and matches title or Project", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "sessions_changed",
        sessions: Array.from({ length: 12 }, (_, index) => ({
          id: `chat-${index}`,
          title: `Chat ${index}`,
          titleSource: "prompt",
          updatedAt: index,
          createdAt: 100 - index,
          messageCount: 1,
          model: "test/script",
          cwd: index % 2 ? "/project" : "/workspace",
          running: index === 11,
        })),
        projects: [
          {
            id: "project",
            name: "Project",
            directories: ["/project"],
            primary: "/project",
            trusted: true,
          },
        ],
        pinned: [],
        archived: ["chat-10"],
        preferences: { sort: "created" },
      }),
    });
    const trigger = screen.getByRole("button", { name: "Search chats", exact: true });
    await trigger.click();
    const dialog = screen.getByRole("dialog", { name: "Search chats" });
    await expect.element(dialog.getByRole("combobox")).toHaveFocus();
    await expect.element(dialog.getByText("Chats", { exact: true })).toBeVisible();
    await expect.element(dialog.getByText("Quick actions", { exact: true })).toBeVisible();
    await expect.poll(() => dialog.element().querySelectorAll('[role="option"]').length).toBe(13);
    const labels = () =>
      Array.from(dialog.element().querySelectorAll('[role="option"]')).map((el) => el.textContent);
    for (const option of dialog.element().querySelectorAll<HTMLElement>('[role="option"]')) {
      expect(getComputedStyle(option).transitionDuration).toBe("0s");
      expect(option.querySelector("span.absolute.inset-0")).toBeNull();
    }
    expect(labels()).toEqual([
      "Chat 11Project",
      "Chat 9Project",
      "Chat 8",
      "Chat 7Project",
      "Chat 6",
      "Chat 5Project",
      "Chat 4",
      "Chat 3Project",
      "Chat 2",
      "Chat 1Project",
      "Chat 0",
      "New chat",
      "Open folder",
    ]);
    await expect
      .element(dialog.getByRole("option", { name: /Running Chat 11 Project/ }))
      .toBeVisible();
    await dialog.getByRole("combobox").fill("Chat 8");
    await expect.element(dialog.getByRole("option", { name: "Chat 8", exact: true })).toBeVisible();
    expect(labels()).toEqual(["Chat 8"]);
    await dialog.getByRole("combobox").fill("Project");
    await expect
      .poll(() => labels())
      .toEqual([
        "Chat 11Project",
        "Chat 9Project",
        "Chat 7Project",
        "Chat 5Project",
        "Chat 3Project",
        "Chat 1Project",
      ]);
    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveFocus();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("Tab focused Open folder opens the shared creation form with Enter", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: async () => ["/chosen-folder"],
      }}
      locale="en"
    />,
  );
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    const trigger = screen.getByRole("button", { name: "Search chats", exact: true });
    await trigger.click();
    await expect.element(screen.getByRole("combobox", { name: "Search chats" })).toHaveFocus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expect
      .element(screen.getByRole("option", { name: "Open folder", exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await screen
      .getByRole("button", { name: "Add folders Rukie can read and edit", exact: true })
      .click();
    await screen.getByRole("button", { name: "Create project", exact: true }).click();
    await screen.getByRole("button", { name: "Trust and create", exact: true }).click();
    await expect
      .poll(() => wireCommands(connection.port), { timeout: 3000 })
      .toContainEqual(
        expect.objectContaining({
          type: "project.create",
          name: "chosen-folder",
          directories: ["/chosen-folder"],
          trusted: true,
        }),
      );
    await expect.element(trigger).toHaveFocus();
    await expect
      .element(screen.getByRole("dialog", { name: "Create project", exact: true }))
      .not.toBeInTheDocument();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("search is centered, clamps narrow viewports and keeps shortcuts outside its A13 results scroll", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const wasDark = document.documentElement.classList.contains("dark");
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify({
        type: "sessions_changed",
        sessions: Array.from({ length: 20 }, (_, index) => ({
          id: `chat-${index}`,
          title: `Chat ${index} ${"long title ".repeat(8)}`,
          titleSource: "prompt",
          updatedAt: index,
          createdAt: index,
          messageCount: 1,
          model: "test/script",
          cwd: "/workspace",
        })),
        projects: [],
        pinned: [],
        archived: [],
        preferences: {},
      }),
    });
    await screen.getByRole("button", { name: "Search chats", exact: true }).click();
    const dialog = screen.getByRole("dialog", { name: "Search chats" });
    await expect.element(dialog.getByRole("combobox")).toHaveFocus();
    // Opacity reaching its target also waits for normal scale entrance; no fixed sleep.
    await expect.poll(() => getComputedStyle(dialog.element()).transform).toBe("none");
    const bounds = dialog.element().getBoundingClientRect();
    expect(bounds.width).toBe(520);
    expect(bounds.left + bounds.width / 2).toBe(640);
    expect(bounds.top + bounds.height / 2).toBe(450);
    expect(getComputedStyle(dialog.element()).borderRadius).toBe("20px");
    const scroll = dialog.getByRole("scrollbar", { name: "Chats" });
    await expect.element(scroll).toBeVisible();
    const scrollbar = scroll.element();
    const viewportId = scroll.element().getAttribute("aria-controls")!;
    const viewport = document.getElementById(viewportId)!;
    expect(viewport.clientHeight).toBe(279);
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    expect(getComputedStyle(viewport).scrollbarWidth).toBe("none");
    expect(scroll.element().getBoundingClientRect().width).toBe(8);
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
    const action = dialog.getByRole("option", { name: "Open folder", exact: true });
    const actionTop = action.element().getBoundingClientRect().top;
    viewport.scrollTop = viewport.scrollHeight;
    await expect
      .poll(() => Number(scroll.element().getAttribute("aria-valuenow")))
      .toBeGreaterThan(0);
    expect(action.element().getBoundingClientRect().top).toBe(actionTop);
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle("dark", dark);
      await page.viewport(420, 300);
      await expect.poll(() => dialog.element().getBoundingClientRect().width).toBe(388);
      const narrow = dialog.element().getBoundingClientRect();
      expect(narrow.left).toBe(16);
      expect(narrow.top).toBeGreaterThanOrEqual(16);
      expect(narrow.bottom).toBeLessThanOrEqual(284);
      expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
      await expect.element(action).toBeVisible();
      expect(getComputedStyle(action.element()).cursor).toBe("pointer");
    }
    await dialog.getByRole("combobox").fill("Chat 19");
    await expect.element(dialog.getByRole("option").first()).toBeVisible();
    await expect.poll(() => getComputedStyle(scrollbar).visibility).toBe("hidden");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
    await page.viewport(1280, 900);
    document.documentElement.classList.toggle("dark", wasDark);
  }
});

test("reduced motion switches search panel and backdrop directly on open and close", async () => {
  await commands.reducedMotion(false);
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="zh"
    />,
  );
  const samples: { opacity: string; transform: string }[] = [];
  let frame = 0;
  let observing = true;
  const observe = () => {
    for (const element of document.querySelectorAll(
      '[role="dialog"][aria-label="搜索聊天"],button[aria-label="关闭搜索聊天"]',
    )) {
      const style = getComputedStyle(element);
      samples.push({ opacity: style.opacity, transform: style.transform });
    }
    if (observing) frame = requestAnimationFrame(observe);
  };
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    // The OS preference can change while the app is already mounted.
    await commands.reducedMotion(true);
    expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    frame = requestAnimationFrame(observe);
    const trigger = screen.getByRole("button", { name: "搜索聊天", exact: true });
    await trigger.click();
    const dialog = screen.getByRole("dialog", { name: "搜索聊天" });
    await expect.element(dialog.getByRole("combobox", { name: "搜索聊天" })).toHaveFocus();
    expect(
      getComputedStyle(screen.getByRole("button", { name: "关闭搜索聊天", exact: true }).element())
        .cursor,
    ).toBe("pointer");
    await expect.element(dialog.getByText("聊天", { exact: true })).toBeVisible();
    await expect.element(dialog.getByText("快捷操作", { exact: true })).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect
      .element(dialog.getByRole("option", { name: "新聊天", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveFocus();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(samples.length).toBeGreaterThan(0);
    expect(
      samples.every(
        ({ opacity, transform }) =>
          (opacity === "0" || opacity === "1") &&
          (transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)"),
      ),
      JSON.stringify(samples),
    ).toBe(true);
  } finally {
    observing = false;
    cancelAnimationFrame(frame);
    await screen.unmount();
    await commands.stopWire(connection.port);
    await commands.reducedMotion(false);
  }
});

test("search keyboard crosses both groups and hands folder dialog focus back to the search trigger", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: async () => ["/new-project"],
      }}
      locale="en"
    />,
  );
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
    await expect
      .element(screen.getByRole("heading", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    const trigger = screen.getByRole("button", { name: "Search chats", exact: true });
    await trigger.click();
    await expect.element(screen.getByRole("combobox", { name: "Search chats" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect
      .element(screen.getByRole("option", { name: "New chat", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    await expect
      .element(
        screen.getByRole("heading", {
          name: "What would you like to talk about today?",
          exact: true,
        }),
      )
      .toBeVisible();
    await expect.element(trigger).toHaveFocus();
    await expect
      .poll(() => wireCommands(connection.port))
      .toContainEqual(expect.objectContaining({ type: "session.unsubscribe", sessionId: "one" }));
    await trigger.click();
    await expect.element(screen.getByRole("combobox", { name: "Search chats" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    const folder = screen.getByRole("dialog", { name: "Create project", exact: true });
    await expect.element(folder.getByRole("textbox")).toHaveFocus();
    await expect
      .element(screen.getByRole("dialog", { name: "Search chats" }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("new-project");
    await folder
      .getByRole("button", { name: "Add folders Rukie can read and edit", exact: true })
      .click();
    await folder.getByRole("button", { name: "Create project", exact: true }).click();
    await screen.getByRole("button", { name: "Trust and create", exact: true }).click();
    await expect.element(trigger).toHaveFocus();
    await expect
      .poll(() => wireCommands(connection.port))
      .toContainEqual(
        expect.objectContaining({
          type: "project.create",
          name: "new-project",
          directories: ["/new-project"],
          trusted: true,
        }),
      );
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
