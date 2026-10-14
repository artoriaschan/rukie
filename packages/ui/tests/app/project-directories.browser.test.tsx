import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

const requests = async (port: number): Promise<Record<string, unknown>[]> =>
  (await fetch(`http://127.0.0.1:${port}/commands`)).json();

test("creating a named Project preserves its folders when trust is cancelled", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  let pick = 0;
  const screen = await render(
    <App
      locale="en"
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: async () => (++pick === 1 ? ["/first", "/second"] : ["/third"]),
      }}
    />,
  );
  try {
    await screen.getByRole("button", { name: "Add project", exact: true }).click();
    let dialog = screen.getByRole("dialog", { name: "Create project", exact: true });
    const name = dialog.getByRole("textbox", { name: "Project name", exact: true });
    await expect.element(name).toHaveFocus();
    await expect
      .element(dialog.getByRole("button", { name: "Create project", exact: true }))
      .toBeDisabled();
    await dialog
      .getByRole("button", { name: "Add folders Rukie can read and edit", exact: true })
      .click();
    await expect.element(name).toHaveValue("first");
    await expect.element(dialog.getByText("first", { exact: true })).toBeVisible();
    await name.fill("  My workspace  ");
    await dialog.getByRole("button", { name: "Add folder", exact: true }).click();
    await expect.element(name).toHaveValue("  My workspace  ");
    await expect.element(dialog.getByText("third", { exact: true })).toBeVisible();
    await name.hover();
    const primary = dialog.getByRole("button", { name: "Set as primary /second", exact: true });
    expect(getComputedStyle(primary.element()).opacity).toBe("0");
    primary.element().focus();
    await userEvent.keyboard("{Enter}");
    await dialog.getByRole("button", { name: "Create project", exact: true }).click();
    dialog = screen.getByRole("dialog", { name: "Trust these folders?", exact: true });
    await expect.element(dialog.getByText("/second", { exact: true })).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
    await expect
      .element(
        dialog.getByText(
          "Rukie can read, edit and run files in these folders. Folder settings may run code automatically, even without a model request. Continue only if you trust every folder listed.",
          { exact: true },
        ),
      )
      .toBeVisible();
    await userEvent.keyboard("{Escape}");
    dialog = screen.getByRole("dialog", { name: "Create project", exact: true });
    await expect
      .element(dialog.getByRole("textbox", { name: "Project name", exact: true }))
      .toHaveValue("  My workspace  ");
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.create" }),
    );
    await dialog.getByRole("button", { name: "Create project", exact: true }).click();
    await screen.getByRole("button", { name: "Trust and create", exact: true }).click();
    await expect
      .poll(() => requests(connection.port))
      .toContainEqual(
        expect.objectContaining({
          type: "project.create",
          name: "My workspace",
          directories: ["/second", "/first", "/third"],
          trusted: true,
        }),
      );
    await expect
      .element(
        screen
          .getByRole("region", { name: "Projects", exact: true })
          .getByRole("button", { name: "My workspace", exact: true }),
      )
      .toBeVisible();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test.each([false, true])(
  "existing untrusted Project confirms before opening; trust=%s still opens history",
  async (accept) => {
    await page.viewport(1280, 900);
    const connection = await commands.startWire();
    const screen = await render(
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
          projects: [
            {
              id: "project",
              name: "Project",
              directories: ["/project", "/other"],
              primary: "/other",
              trusted: false,
            },
          ],
          sessions: [
            {
              id: "one",
              title: "Fix compiler",
              titleSource: "prompt",
              cwd: "/project",
              model: "test/script",
              createdAt: 1,
              updatedAt: 2,
              messageCount: 1,
            },
          ],
          pinned: [],
          archived: [],
          preferences: {},
        }),
      });
      await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
      await expect
        .element(screen.getByRole("dialog", { name: "Trust these folders?", exact: true }))
        .toBeVisible();
      expect(await requests(connection.port)).not.toContainEqual(
        expect.objectContaining({ type: "session.subscribe" }),
      );
      await screen.getByRole("button", { name: accept ? "Trust" : "Cancel", exact: true }).click();
      await expect
        .poll(() => requests(connection.port))
        .toContainEqual(expect.objectContaining({ type: "session.subscribe", sessionId: "one" }));
      if (accept)
        expect(await requests(connection.port)).toContainEqual(
          expect.objectContaining({ type: "project.trust", projectId: "project" }),
        );
      else
        expect(await requests(connection.port)).not.toContainEqual(
          expect.objectContaining({ type: "project.trust" }),
        );
      if (!accept) {
        await screen.getByRole("button", { name: "New chat", exact: true }).click();
        await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
        await expect
          .element(screen.getByRole("dialog", { name: "Trust these folders?", exact: true }))
          .toBeVisible();
        await screen.getByRole("button", { name: "Trust", exact: true }).click();
        await expect
          .poll(() => requests(connection.port))
          .toContainEqual(expect.objectContaining({ type: "project.trust", projectId: "project" }));
      }
    } finally {
      await screen.unmount();
      await commands.stopWire(connection.port);
    }
  },
);

test("any Project directory groups and names history, and switching primary affects future chats", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      locale="en"
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: async () => ["/first"],
      }}
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
        projects: [
          {
            id: "project",
            name: "Cross repo",
            directories: ["/first", "/second"],
            primary: "/first",
            trusted: true,
          },
        ],
        sessions: [
          {
            id: "one",
            title: "Existing second repo",
            titleSource: "prompt",
            cwd: "/second",
            model: "test/script",
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
          },
        ],
        pinned: [],
        archived: [],
        preferences: {},
      }),
    });
    await screen.getByRole("button", { name: "Search chats", exact: true }).click();
    await screen.getByRole("combobox", { name: "Search chats", exact: true }).fill("Cross repo");
    await expect
      .element(screen.getByRole("option", { name: "Existing second repo Cross repo", exact: true }))
      .toBeVisible();
    await userEvent.keyboard("{Escape}");
    await screen.getByRole("button", { name: "Add project", exact: true }).click();
    await screen
      .getByRole("button", { name: "Add folders Rukie can read and edit", exact: true })
      .click();
    await expect
      .element(
        screen.getByRole("heading", { name: "What should we build in Cross repo?", exact: true }),
      )
      .toBeVisible();
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.create" }),
    );
    await screen.getByRole("main").getByRole("button", { name: "Cross repo", exact: true }).click();
    await screen.getByRole("menuitem", { name: "Edit project", exact: true }).click();
    const setPrimary = screen.getByRole("button", { name: "Set as primary /second", exact: true });
    await setPrimary.hover();
    expect(getComputedStyle(setPrimary.element()).opacity).toBe("1");
    await setPrimary.click();
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.update" }),
    );
    await screen.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => requests(connection.port))
      .toContainEqual(
        expect.objectContaining({
          type: "project.update",
          projectId: "project",
          primary: "/second",
          directories: ["/first", "/second"],
          name: "Cross repo",
        }),
      );
    await screen
      .getByRole("textbox", { name: "Prompt", exact: true })
      .fill("new after primary switch");
    await screen.getByRole("button", { name: "Send prompt", exact: true }).click();
    await expect
      .poll(() => requests(connection.port))
      .toContainEqual(expect.objectContaining({ type: "session.create", project: "project" }));
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

for (const code of ["project_conflict", "project_reserved"] as const) {
  test(`${code} returns to its named form with a localized creation error`, async () => {
    await page.viewport(1280, 900);
    const connection = await commands.startWire();
    const screen = await render(
      <App
        locale="en"
        host={{
          getConnection: async () => connection,
          modelServices: modelServicesFixture,
          pickProjectFolder: async () => ["/reserved"],
        }}
      />,
    );
    try {
      await expect
        .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
        .toBeVisible();
      await screen.getByRole("button", { name: "Add project", exact: true }).click();
      await screen
        .getByRole("button", { name: "Add folders Rukie can read and edit", exact: true })
        .click();
      await screen.getByRole("button", { name: "Create project", exact: true }).click();
      await fetch(`http://127.0.0.1:${connection.port}/error`, {
        method: "POST",
        body: JSON.stringify({ type: "project.create", code, params: { project: "Other repo" } }),
      });
      await screen.getByRole("button", { name: "Trust and create", exact: true }).click();
      await expect
        .element(
          screen
            .getByRole("dialog", { name: "Create project", exact: true })
            .getByRole("textbox", { name: "Project name", exact: true }),
        )
        .toHaveValue("reserved");
      await expect
        .element(screen.getByRole("alert"))
        .toHaveTextContent(
          code === "project_conflict"
            ? "This folder already belongs to Other repo."
            : "Application data folders cannot be added as a Project.",
        );
    } finally {
      await screen.unmount();
      await commands.stopWire(connection.port);
    }
  });
}

test("directory rows distinguish names, reserve primary controls, reveal full paths and protect the last folder", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      locale="en"
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: async () => ["/alpha/repo", "/beta/repo", "/gamma/extra"],
      }}
    />,
  );
  try {
    await screen.getByRole("button", { name: "Add project", exact: true }).click();
    const dialog = screen.getByRole("dialog", { name: "Create project", exact: true });
    await dialog
      .getByRole("button", { name: "Add folders Rukie can read and edit", exact: true })
      .click();
    await expect.element(dialog.getByText("alpha", { exact: true })).toBeVisible();
    await expect.element(dialog.getByText("beta", { exact: true })).toBeVisible();
    const action = dialog.getByRole("button", { name: "Set as primary /beta/repo", exact: true });
    const row = action.element().parentElement!;
    await dialog.getByRole("textbox").hover();
    const before = row.getBoundingClientRect();
    const nameBefore = row.querySelector("span")!.getBoundingClientRect();
    expect(row.closest("li")!.getBoundingClientRect().height).toBe(32);
    await action.hover();
    await expect.poll(() => getComputedStyle(action.element()).opacity).toBe("1");
    const after = row.getBoundingClientRect();
    expect(after.width).toBe(before.width);
    expect(row.querySelector("span")!.getBoundingClientRect().width).toBe(nameBefore.width);
    const tooltip = screen.getByRole("tooltip").filter({ hasText: "/beta/repo" });
    await expect.element(tooltip).toBeVisible();
    await expect
      .poll(() =>
        Math.abs(
          row.getBoundingClientRect().top - tooltip.element().getBoundingClientRect().bottom - 4,
        ),
      )
      .toBeLessThanOrEqual(1);
    expect(getComputedStyle(tooltip.element()).backgroundColor).toBe("rgb(22, 22, 22)");
    const hintBox = tooltip.element().getBoundingClientRect();
    expect(
      tooltip.element().contains(document.elementFromPoint(hintBox.left + 4, hintBox.top + 4)),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Remove folder /alpha/repo", exact: true }).click();
    await expect.element(dialog.getByText("alpha", { exact: true })).not.toBeInTheDocument();
    await expect
      .element(dialog.getByRole("button", { name: "Set as primary /beta/repo", exact: true }))
      .not.toBeInTheDocument();
    await dialog.getByRole("button", { name: "Remove folder /gamma/extra", exact: true }).click();
    const last = dialog.getByRole("button", { name: "Remove folder /beta/repo", exact: true });
    await expect.element(last).toBeDisabled();
    expect(getComputedStyle(last.element()).cursor).toBe("not-allowed");
    await dialog.getByRole("textbox").fill("  ");
    await expect
      .element(dialog.getByRole("button", { name: "Create project", exact: true }))
      .toBeDisabled();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test.each([
  { width: 1280, dark: false },
  { width: 420, dark: true },
])(
  "Project dialogs preserve the shell and scroll long folder lists at $width (dark=$dark)",
  async ({ width, dark }) => {
    await page.viewport(width, 700);
    await commands.reducedMotion(true);
    const previous = document.documentElement.className;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    const connection = await commands.startWire();
    const directories = Array.from(
      { length: 24 },
      (_, i) => `/folders/long-parent-${i}/repository-${i}`,
    );
    const screen = await render(
      <App
        locale={dark ? "zh" : "en"}
        host={{
          getConnection: async () => connection,
          modelServices: modelServicesFixture,
          pickProjectFolder: async () => directories,
        }}
      />,
    );
    try {
      if (width === 420)
        await screen.getByRole("button", { name: "切换侧栏", exact: true }).click();
      const shell = [
        ...document.querySelectorAll<HTMLElement>(".app-titlebar, .app-workspace, main"),
      ];
      const baseline = shell.map((element) => element.getBoundingClientRect());
      await screen
        .getByRole("button", { name: dark ? "添加项目" : "Add project", exact: true })
        .click();
      let dialog = screen.getByRole("dialog", {
        name: dark ? "创建项目" : "Create project",
        exact: true,
      });
      const entry = dialog.getByRole("button", {
        name: dark ? "添加 Rukie 可读取和编辑的文件夹" : "Add folders Rukie can read and edit",
        exact: true,
      });
      expect(entry.element().getBoundingClientRect().height).toBe(104);
      expect(dialog.element().getBoundingClientRect().width).toBe(Math.min(480, width - 32));
      expect(getComputedStyle(dialog.element().firstElementChild!).paddingLeft).toBe(
        width === 420 ? "16px" : "24px",
      );
      await entry.click();
      const name = dialog.getByRole("textbox", {
        name: dark ? "项目名称" : "Project name",
        exact: true,
      });
      expect(name.element().parentElement!.getBoundingClientRect().height).toBe(32);
      name.element().focus();
      await expect
        .poll(() => getComputedStyle(name.element().parentElement!).boxShadow)
        .toContain("inset");
      expect(getComputedStyle(dialog.element()).boxShadow).not.toBe("none");
      const viewport = dialog
        .element()
        .querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
      expect(viewport.clientHeight).toBeLessThanOrEqual(240);
      expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
      const footer = dialog.getByRole("button", {
        name: dark ? "创建项目" : "Create project",
        exact: true,
      });
      const footerBox = footer.element().getBoundingClientRect();
      viewport.scrollTop = viewport.scrollHeight;
      expect(footer.element().getBoundingClientRect().top).toBe(footerBox.top);
      await footer.click();
      dialog = screen.getByRole("dialog", {
        name: dark ? "信任这些文件夹吗？" : "Trust these folders?",
        exact: true,
      });
      expect(dialog.element().getBoundingClientRect().width).toBe(Math.min(416, width - 32));
      const trustViewport = dialog
        .element()
        .querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
      expect(trustViewport.clientHeight).toBeLessThanOrEqual(240);
      expect(trustViewport.scrollHeight).toBeGreaterThan(trustViewport.clientHeight);
      await expect.element(dialog.getByText(directories[0]!, { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: dark ? "关闭" : "Close", exact: true }).click();
      dialog = screen.getByRole("dialog", {
        name: dark ? "创建项目" : "Create project",
        exact: true,
      });
      await expect.element(dialog.getByRole("textbox")).toHaveValue("repository-0");
      await dialog
        .getByRole("button", { name: dark ? "创建项目" : "Create project", exact: true })
        .click();
      dialog = screen.getByRole("dialog", {
        name: dark ? "信任这些文件夹吗？" : "Trust these folders?",
        exact: true,
      });
      const confirm = dialog.getByRole("button", {
        name: dark ? "信任并创建" : "Trust and create",
        exact: true,
      });
      const cancel = dialog.getByRole("button", { name: dark ? "取消" : "Cancel", exact: true });
      const confirmBox = confirm.element().getBoundingClientRect(),
        cancelBox = cancel.element().getBoundingClientRect();
      expect(confirmBox.height).toBe(36);
      expect(cancelBox.height).toBe(32);
      expect(cancelBox.top - confirmBox.bottom).toBe(8);
      expect(confirmBox.width).toBe(cancelBox.width);
      await fetch(`http://127.0.0.1:${connection.port}/hold`, { method: "POST" });
      await confirm.click();
      await expect.element(confirm).toBeDisabled();
      await expect.element(cancel).toBeDisabled();
      await expect
        .element(dialog.getByRole("button", { name: dark ? "关闭" : "Close", exact: true }))
        .toBeDisabled();
      await userEvent.keyboard("{Escape}");
      await expect.element(dialog).toBeVisible();
      await fetch(`http://127.0.0.1:${connection.port}/flush`, { method: "POST" });
      await expect.element(dialog).not.toBeInTheDocument();
      for (const [index, element] of shell.entries()) {
        const rect = element.getBoundingClientRect();
        for (const key of ["x", "y", "width", "height"] as const)
          expect(Math.abs(rect[key] - baseline[index]![key])).toBeLessThanOrEqual(1);
      }
    } finally {
      await screen.unmount();
      await commands.stopWire(connection.port);
      document.documentElement.className = previous;
      await commands.reducedMotion(false);
    }
  },
);

test("choosing an already registered primary opens its Project without creating another", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      locale="en"
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: async () => ["/new-folder", "/project"],
      }}
    />,
  );
  try {
    await screen.getByRole("button", { name: "Add project", exact: true }).click();
    await screen
      .getByRole("button", { name: "Add folders Rukie can read and edit", exact: true })
      .click();
    await screen.getByRole("button", { name: "Set as primary /project", exact: true }).click();
    await screen.getByRole("button", { name: "Create project", exact: true }).click();
    await expect
      .element(
        screen.getByRole("heading", { name: "What should we build in Project?", exact: true }),
      )
      .toBeVisible();
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.create" }),
    );
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
