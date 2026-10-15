import { act } from "react";
import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

const requests = async (port: number): Promise<Record<string, unknown>[]> =>
  (await fetch(`http://127.0.0.1:${port}/commands`)).json();

const menuLabels = (menu: Element) =>
  [...menu.children].map((child) =>
    child.tagName === "HR" ? "---" : (child.textContent ?? "").trim(),
  );

async function start(locale: "en" | "zh" = "en") {
  const owner = ownProjectBrowserTest();
  await page.viewport(1280, 900);
  const connection = await owner.startWire();
  const screen = await owner.render(
    <App
      locale={locale}
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
    />,
  );
  return { owner, connection, screen };
}

test.each(["en", "zh"] as const)(
  "%s Project right-click menu lists the C23 actions without opening details",
  async (locale) => {
    const { owner, screen } = await start(locale);
    try {
      const projects = screen.getByRole("region", {
        name: locale === "en" ? "Projects" : "项目",
        exact: true,
      });
      const row = projects.getByRole("button", { name: "Project", exact: true });
      await row.click({ button: "right" });
      const menu = screen.getByRole("menu", {
        name: locale === "en" ? "Project actions" : "项目操作",
        exact: true,
      });
      await expect.element(menu).toBeVisible();
      expect(menuLabels(menu.element())).toEqual(
        locale === "en"
          ? [
              "Rename",
              "Edit project…",
              "Pin",
              "New chat in this project",
              "Open in Finder",
              "---",
              "Delete project",
            ]
          : [
              "重命名",
              "编辑项目…",
              "置顶",
              "在此项目下新建对话",
              "在 Finder 中打开",
              "---",
              "删除项目",
            ],
      );
      for (const item of menu.getByRole("menuitem").all())
        expect(item.element().querySelectorAll("svg")).toHaveLength(1);
      expect(menu.element().querySelector("kbd")).toBeNull();
      // Hovering the row while its menu is open must not stack the detail card on the menu.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await act(async () => {
        row
          .element()
          .parentElement!.dispatchEvent(
            new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", pointerId: 1 }),
          );
        await vi.advanceTimersByTimeAsync(300);
      });
      vi.useRealTimers();
      const card = document.querySelector<HTMLElement>(
        `[aria-label="${locale === "en" ? "Project details" : "项目详情"}"]`,
      );
      expect(card === null || getComputedStyle(card).visibility === "hidden").toBe(true);
      await userEvent.keyboard("{Escape}");
      await expect.element(menu).not.toBeInTheDocument();
    } finally {
      await owner.close();
    }
  },
);

test("pinning a Project moves it into Pinned and unpinning returns it to Projects", async () => {
  const { owner, connection, screen } = await start();
  try {
    const projects = screen.getByRole("region", { name: "Projects", exact: true });
    await projects.getByRole("button", { name: "Project", exact: true }).click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Pin", exact: true }).click();
    const pinned = screen.getByRole("region", { name: "Pinned", exact: true });
    await expect.element(pinned.getByRole("group", { name: "Project", exact: true })).toBeVisible();
    await expect
      .element(projects.getByRole("group", { name: "Project", exact: true }))
      .not.toBeInTheDocument();
    // The pinned Project leads Pinned, before individually pinned Sessions.
    const order = [...pinned.element().querySelectorAll('[role="group"], button')].map(
      (element) => element.getAttribute("aria-label") ?? element.textContent?.trim(),
    );
    expect(order.indexOf("Project")).toBeLessThan(order.indexOf("Fix compiler"));
    expect(
      (await requests(connection.port))
        .filter((request) => request.type === "preferences.set")
        .at(-1),
    ).toMatchObject({ preferences: { pinnedProjects: ["project"] } });

    await pinned.getByRole("button", { name: "Project", exact: true }).click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Unpin", exact: true }).click();
    await expect
      .element(projects.getByRole("group", { name: "Project", exact: true }))
      .toBeVisible();
    await expect
      .element(pinned.getByRole("group", { name: "Project", exact: true }))
      .not.toBeInTheDocument();
  } finally {
    await owner.close();
  }
});

test("Project menu renames, edits, starts a chat and reveals the primary folder", async () => {
  const { owner, connection, screen } = await start();
  const open = async (name = "Project") => {
    await screen
      .getByRole("region", { name: "Projects", exact: true })
      .getByRole("button", { name, exact: true })
      .click({ button: "right" });
  };
  try {
    await open();
    await screen.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const rename = screen.getByRole("dialog", { name: "Rename project", exact: true });
    const input = rename.getByRole("textbox", { name: "Project name", exact: true });
    await expect.element(input).toHaveValue("Project");
    await expect.element(rename.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await input.fill("Renamed");
    await rename.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(rename).not.toBeInTheDocument();
    expect(
      (await requests(connection.port)).filter((request) => request.type === "project.update"),
    ).toEqual([
      expect.objectContaining({
        projectId: "project",
        name: "Renamed",
        directories: ["/project"],
        primary: "/project",
      }),
    ]);
    await expect.element(screen.getByRole("group", { name: "Renamed", exact: true })).toBeVisible();

    await open("Renamed");
    await screen.getByRole("menuitem", { name: "Edit project…", exact: true }).click();
    const edit = screen.getByRole("dialog", { name: "Edit project", exact: true });
    await expect.element(edit).toBeVisible();
    await edit.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(edit).not.toBeInTheDocument();

    await open("Renamed");
    await screen.getByRole("menuitem", { name: "Open in Finder", exact: true }).click();
    await expect
      .poll(async () =>
        (await requests(connection.port)).filter((request) => request.type === "host.revealPath"),
      )
      .toEqual([expect.objectContaining({ path: "/project" })]);

    await open("Renamed");
    await screen.getByRole("menuitem", { name: "New chat in this project", exact: true }).click();
    await expect
      .element(screen.getByRole("heading", { name: /What should we build/ }))
      .toHaveTextContent("What should we build in Renamed?");
  } finally {
    await owner.close();
  }
});

test("Delete project confirms with C31; cancel closes without removing", async () => {
  const { owner, connection, screen } = await start();
  const open = async () => {
    await screen
      .getByRole("region", { name: "Projects", exact: true })
      .getByRole("button", { name: "Project", exact: true })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Delete project", exact: true }).click();
    return screen.getByRole("dialog", { name: "Remove Project?", exact: true });
  };
  try {
    let dialog = await open();
    await expect.element(dialog.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("dialog", { name: "Edit project", exact: true }))
      .not.toBeInTheDocument();
    expect(
      (await requests(connection.port)).some((request) => request.type === "project.remove"),
    ).toBe(false);

    dialog = await open();
    await dialog.getByRole("button", { name: "Remove project", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(
      (await requests(connection.port)).filter((request) => request.type === "project.remove"),
    ).toEqual([expect.objectContaining({ projectId: "project" })]);
    await expect
      .element(screen.getByRole("group", { name: "Project", exact: true }))
      .not.toBeInTheDocument();
  } finally {
    await owner.close();
  }
});

test("keyboard opens the Project menu and Escape returns to the row without details", async () => {
  const { owner, screen } = await start();
  try {
    const row = screen
      .getByRole("region", { name: "Projects", exact: true })
      .getByRole("button", { name: "Project", exact: true });
    await expect.element(row).toBeVisible();
    row.element().focus();
    const card = screen.getByRole("dialog", { name: "Project details", exact: true });
    await expect.element(card).toBeVisible();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const menu = screen.getByRole("menu", { name: "Project actions", exact: true });
    await expect.element(menu).toBeVisible();
    await expect.element(card).not.toBeInTheDocument();
    await expect.element(menu.getByRole("menuitem", { name: "Rename", exact: true })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .element(menu.getByRole("menuitem", { name: "Delete project", exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(menu).not.toBeInTheDocument();
    await expect.element(row).toHaveFocus();
    await expect.element(card).not.toBeInTheDocument();
  } finally {
    await owner.close();
  }
});
