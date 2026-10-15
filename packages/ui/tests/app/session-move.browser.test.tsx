import { expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { WireSessionSummary } from "@rukie/shared";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test("all three Session menus share move targets and moving changes the sidebar Project group", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    const row = screen.getByRole("button", { name: "Explore ideas", exact: true });
    await row.click();
    const regions = [
      screen.getByRole("banner").element(),
      screen.getByRole("main").element(),
      screen.getByRole("navigation", { name: "Home", exact: true }).element(),
    ];
    const baseline = regions.map((element) => element.getBoundingClientRect());
    for (const entry of ["context", "row", "title"]) {
      if (entry === "context") await row.click({ button: "right" });
      if (entry === "row")
        await screen
          .getByRole("button", { name: "Session actions Explore ideas", exact: true })
          .click();
      if (entry === "title")
        await screen.getByRole("button", { name: "Session actions", exact: true }).click();
      const move = screen.getByRole("menuitem", { name: "Move to Project", exact: true });
      await expect.element(move).toBeEnabled();
      await move.hover();
      const target = screen.getByRole("menuitem", { name: "Project", exact: true });
      await expect.element(target).toBeVisible();
      await expect
        .element(screen.getByRole("menuitem", { name: "Choose folder…", exact: true }))
        .toBeVisible();
      await expect
        .element(screen.getByRole("menuitem", { name: "Move out of Project", exact: true }))
        .not.toBeInTheDocument();
      expect(getComputedStyle(target.element()).cursor).toBe("pointer");
      regions.forEach((element, index) => {
        const box = element.getBoundingClientRect(),
          original = baseline[index]!;
        for (const key of ["x", "y", "width", "height"] as const)
          expect(Math.abs(box[key] - original[key])).toBeLessThanOrEqual(1);
      });
      if (entry !== "title") {
        await userEvent.keyboard("{Escape}");
        await userEvent.keyboard("{Escape}");
      } else await target.click();
    }
    await expect
      .element(
        screen
          .getByRole("region", { name: "Projects", exact: true })
          .getByRole("button", { name: "Explore ideas", exact: true }),
      )
      .toBeVisible();
    const sent = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(sent.filter((command: { type: string }) => command.type === "session.move")).toEqual([
      expect.objectContaining({ sessionId: "two", projectId: "project" }),
    ]);
    await screen.getByRole("button", { name: "Session actions", exact: true }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Move to Project", exact: true }))
      .not.toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    for (const entry of ["context", "row", "title"]) {
      if (entry === "context") await row.click({ button: "right" });
      if (entry === "row")
        await screen
          .getByRole("button", { name: "Session actions Explore ideas", exact: true })
          .click();
      if (entry === "title")
        await screen.getByRole("button", { name: "Session actions", exact: true }).click();
      const move = screen.getByRole("menuitem", { name: "Move to Project", exact: true });
      await move.hover();
      await expect
        .element(screen.getByRole("menuitem", { name: "Choose folder…", exact: true }))
        .toBeVisible();
      const out = screen.getByRole("menuitem", { name: "Move out of Project", exact: true });
      await expect.element(out).toBeVisible();
      if (entry === "title") await out.click();
      else {
        await userEvent.keyboard("{Escape}");
        await userEvent.keyboard("{Escape}");
      }
    }
    await expect
      .element(
        screen
          .getByRole("region", { name: "Conversations", exact: true })
          .getByRole("button", { name: "Explore ideas", exact: true }),
      )
      .toBeVisible();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

async function publish(port: number, value: unknown) {
  await fetch(`http://127.0.0.1:${port}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}
const moveProjects = [
  {
    id: "project",
    name: "Project",
    directories: ["/project", "/project/docs"],
    primary: "/project",
    trusted: true,
  },
  {
    id: "target",
    name: "Target",
    directories: ["/target", "/target/docs"],
    primary: "/target",
    trusted: false,
  },
];
const moveSession: WireSessionSummary = {
  id: "one",
  title: "Fix compiler",
  titleSource: "prompt",
  cwd: "/project/docs",
  projectId: "project",
  worktree: null,
  updatedAt: 20,
  createdAt: 10,
  messageCount: 1,
  model: "test/script",
};
function changed(session = moveSession, projects = moveProjects) {
  return {
    type: "sessions_changed",
    homeDir: "/fixture-home",
    sessions: [session],
    projects,
    pinned: [],
    archived: [],
    preferences: {},
  };
}

test("moving to an untrusted Project confirms first; cancel sends nothing and failure stays visible", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    await publish(connection.port, changed());
    const chooseTarget = async () => {
      await screen
        .getByRole("button", { name: "Session actions Fix compiler", exact: true })
        .click();
      await screen.getByRole("menuitem", { name: "Move to Project", exact: true }).hover();
      // Secondary-directory membership still marks the Session's current Project.
      const current = screen.getByRole("menuitem", { name: "Project", exact: true });
      await expect.element(current).toHaveAttribute("aria-current", "true");
      await expect.element(current).toHaveAttribute("aria-disabled", "true");
      expect(current.element().querySelectorAll("svg")).toHaveLength(2);
      await screen.getByRole("menuitem", { name: "Target", exact: true }).click();
    };
    await chooseTarget();
    let dialog = screen.getByRole("dialog", { name: "Trust these folders?", exact: true });
    await expect.element(dialog.getByText("/target", { exact: true })).toBeVisible();
    await expect.element(dialog.getByText("/target/docs", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    let sent = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(
      sent.filter((command: { type: string }) =>
        ["project.trust", "session.move"].includes(command.type),
      ),
    ).toEqual([]);
    await chooseTarget();
    dialog = screen.getByRole("dialog", { name: "Trust these folders?", exact: true });
    await fetch(`http://127.0.0.1:${connection.port}/error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session.move", code: "session_busy" }),
    });
    await dialog.getByRole("button", { name: "Trust", exact: true }).click();
    await expect
      .element(dialog.getByRole("alert"))
      .toHaveTextContent("This Session is open elsewhere. Close it there, then retry.");
    sent = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(
      sent
        .filter((command: { type: string }) =>
          ["project.trust", "session.move"].includes(command.type),
        )
        .map((command: { type: string }) => command.type),
    ).toEqual(["project.trust", "session.move"]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await chooseTarget();
    await expect
      .poll(async () => {
        const commands = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
        return commands.filter((command: { type: string }) => command.type === "session.move")
          .length;
      })
      .toBe(2);
    const targetGroup = screen.getByRole("group", { name: "Target", exact: true }).element();
    expect(targetGroup.textContent).toContain("Fix compiler");
    // Trust succeeded even though moving failed; the retry now moves directly.
    await expect
      .element(
        screen
          .getByRole("region", { name: "Projects", exact: true })
          .getByRole("button", { name: "Fix compiler", exact: true }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("dialog", { name: "Trust these folders?", exact: true }))
      .not.toBeInTheDocument();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test.each(["running", "waitingPermission", "worktree"] as const)(
  "%s Sessions disable moving from all three menus",
  async (status) => {
    await page.viewport(1280, 900);
    const connection = await commands.startWire();
    const screen = await render(
      <App
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
        locale="en"
      />,
    );
    try {
      await publish(
        connection.port,
        changed({
          ...moveSession,
          [status]: status === "worktree" ? { id: "w", branch: "rukie/worktree-test" } : true,
        }),
      );
      const row = screen.getByRole("button", {
        name: /^(?:Running |Waiting for confirmation )?Fix compiler$/,
      });
      await row.click();
      for (const entry of ["context", "row", "title"]) {
        if (entry === "context") await row.click({ button: "right" });
        if (entry === "row")
          await screen
            .getByRole("button", { name: "Session actions Fix compiler", exact: true })
            .click();
        if (entry === "title")
          await screen.getByRole("button", { name: "Session actions", exact: true }).click();
        const move = screen.getByRole("menuitem", { name: "Move to Project", exact: true });
        if (entry === "context") await expect.element(move).toBeDisabled();
        else await expect.element(move).toHaveAttribute("aria-disabled", "true");
        expect(getComputedStyle(move.element()).cursor).toBe("not-allowed");
        await move.click({ force: true });
        await expect
          .element(screen.getByRole("menuitem", { name: "Target", exact: true }))
          .not.toBeInTheDocument();
        await userEvent.keyboard("{Escape}");
      }
      await publish(connection.port, changed());
      await screen
        .getByRole("button", { name: "Fix compiler", exact: true })
        .click({ button: "right" });
      await screen.getByRole("menuitem", { name: "Move to Project", exact: true }).click();
      await publish(
        connection.port,
        changed({
          ...moveSession,
          [status]: status === "worktree" ? { id: "w", branch: "rukie/worktree-test" } : true,
        }),
      );
      await expect
        .element(screen.getByRole("menuitem", { name: "Target", exact: true }))
        .toBeDisabled();
      const sent = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
      expect(sent.some((command: { type: string }) => command.type === "session.move")).toBe(false);
    } finally {
      await screen.unmount();
      await commands.stopWire(connection.port);
    }
  },
);

test("context menu move targets open in a hover flyout beside the menu", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const pointer = (element: Element, x: number, y: number) =>
    element.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerType: "mouse",
      }),
    );
  try {
    await publish(connection.port, changed());
    await screen
      .getByRole("button", { name: "Fix compiler", exact: true })
      .click({ button: "right" });
    const root = screen.getByRole("menu", { name: "Session actions", exact: true }).element();
    const move = screen.getByRole("menuitem", { name: "Move to Project", exact: true });
    await move.hover();
    await expect.element(move).toHaveAttribute("aria-expanded", "true");
    const flyout = screen.getByRole("menu", { name: "Move to Project", exact: true });
    await expect.element(flyout).toBeVisible();
    expect(root.contains(flyout.element())).toBe(false);
    const panel = flyout.element().getBoundingClientRect();
    const menu = root.getBoundingClientRect();
    const trigger = move.element().getBoundingClientRect();
    expect(panel.left - menu.right).toBeCloseTo(4, 0);
    expect(panel.top).toBeCloseTo(trigger.top - 4, 0);
    expect(
      [...flyout.element().children].map((child) =>
        child.tagName === "HR" ? "---" : (child.textContent ?? "").trim(),
      ),
    ).toEqual(["Project", "Target", "---", "Choose folder…", "Move out of Project"]);
    const current = flyout.getByRole("menuitem", { name: "Project", exact: true });
    await expect.element(current).toBeDisabled();
    await expect.element(current).toHaveAttribute("aria-current", "true");
    await expect
      .element(flyout.getByRole("menuitem", { name: "Target", exact: true }))
      .not.toHaveAttribute("aria-current");

    // Crossing a lower root row on the way to the flyout keeps the flyout open.
    const remove = screen.getByRole("menuitem", { name: "Delete chat", exact: true }).element();
    const row = remove.getBoundingClientRect();
    const y = Math.min(row.top + row.height / 2, panel.bottom - 2);
    pointer(remove, row.right - 40, y);
    pointer(remove, row.right - 10, y);
    await expect.element(flyout).toBeVisible();
    expect(document.activeElement).not.toBe(remove);
    // Moving back away from the flyout hands focus to the pointed root row.
    pointer(remove, row.right - 60, y);
    await expect.element(remove).toHaveFocus();
    await expect.element(flyout).not.toBeInTheDocument();
    await expect.element(move).toHaveAttribute("aria-expanded", "false");

    await move.hover();
    await flyout.getByRole("menuitem", { name: "Target", exact: true }).hover();
    await expect.element(flyout).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(move).toHaveFocus();
    await expect.element(flyout).not.toBeInTheDocument();
    await expect.element(screen.getByRole("menu", { name: "Session actions" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("menu", { name: "Session actions" }))
      .not.toBeInTheDocument();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("keyboard opens nested move targets, preserves narrow geometry and reports localized failure", async () => {
  await page.viewport(420, 700);
  const previous = document.documentElement.className;
  document.documentElement.classList.add("dark");
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="zh"
    />,
  );
  try {
    await screen.getByRole("button", { name: "切换侧栏", exact: true }).click();
    const row = screen.getByRole("button", { name: "Explore ideas", exact: true });
    await row.click({ button: "right" });
    const move = screen.getByRole("menuitem", { name: "移到项目", exact: true });
    move.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    const target = screen.getByRole("menuitem", { name: "Project", exact: true });
    await expect.element(target).toHaveFocus();
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      const box = menu.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(420);
      expect(box.bottom).toBeLessThanOrEqual(700);
    }
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(move).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await fetch(`http://127.0.0.1:${connection.port}/error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session.move", code: "session_busy" }),
    });
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("操作失败：这个 Session 正在别处打开，关闭后再试。");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
    document.documentElement.className = previous;
  }
});

test.each([
  "new",
  "existing",
  "conflict",
  "move-failure",
  "cancel-picker",
  "cancel-trust",
] as const)("choose folder %s confirms trust before creating and moving", async (outcome) => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const folder = outcome === "existing" ? "/project" : "/chosen/new";
  const pick = vi.fn(async () => (outcome === "cancel-picker" ? null : [folder]));
  const screen = await render(
    <App
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: pick,
      }}
      locale="en"
    />,
  );
  const sent = async () =>
    (await fetch(`http://127.0.0.1:${connection.port}/commands`).then((response) =>
      response.json(),
    )) as { type: string; projectId?: string }[];
  try {
    await screen
      .getByRole("button", { name: "Session actions Explore ideas", exact: true })
      .click();
    await screen.getByRole("menuitem", { name: "Move to Project", exact: true }).hover();
    await screen.getByRole("menuitem", { name: "Choose folder…", exact: true }).click();
    expect(pick).toHaveBeenCalledWith(false);
    if (outcome === "cancel-picker") {
      expect(
        (await sent()).filter((command) =>
          ["project.create", "session.move"].includes(command.type),
        ),
      ).toEqual([]);
      await expect
        .element(screen.getByRole("dialog", { name: "Trust these folders?", exact: true }))
        .not.toBeInTheDocument();
      return;
    }
    const dialog = screen.getByRole("dialog", { name: "Trust these folders?", exact: true });
    await expect.element(dialog.getByText(folder, { exact: true })).toBeVisible();
    expect(
      (await sent()).filter((command) => ["project.create", "session.move"].includes(command.type)),
    ).toEqual([]);
    if (outcome === "cancel-trust") {
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(
        (await sent()).filter((command) =>
          ["project.create", "session.move"].includes(command.type),
        ),
      ).toEqual([]);
      return;
    }
    if (outcome === "conflict" || outcome === "move-failure")
      await fetch(`http://127.0.0.1:${connection.port}/error`, {
        method: "POST",
        body: JSON.stringify(
          outcome === "conflict"
            ? {
                type: "project.create",
                code: "project_conflict",
                params: { project: "Other", directory: folder },
              }
            : { type: "session.move", code: "session_busy" },
        ),
      });
    await dialog.getByRole("button", { name: "Trust and create", exact: true }).click();
    if (outcome === "conflict" || outcome === "move-failure") {
      await expect
        .element(dialog.getByRole("alert"))
        .toHaveTextContent(
          outcome === "conflict"
            ? "This folder already belongs to Other."
            : "This Session is open elsewhere. Close it there, then retry.",
        );
      const calls = (await sent()).filter((command) =>
        ["project.create", "session.move"].includes(command.type),
      );
      expect(calls.map((command) => command.type)).toEqual(
        outcome === "conflict" ? ["project.create"] : ["project.create", "session.move"],
      );
      if (outcome === "move-failure")
        await expect
          .element(screen.getByRole("button", { name: "new", exact: true }))
          .toBeVisible();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    } else {
      await expect.element(dialog).not.toBeInTheDocument();
      expect(
        (await sent()).filter((command) =>
          ["project.create", "session.move"].includes(command.type),
        ),
      ).toMatchObject([
        {
          type: "project.create",
          name: outcome === "existing" ? "project" : "new",
          directories: [folder],
          trusted: true,
        },
        {
          type: "session.move",
          sessionId: "two",
          projectId: outcome === "existing" ? "project" : "added",
        },
      ]);
      await expect
        .element(
          screen
            .getByRole("group", { name: outcome === "existing" ? "Project" : "new", exact: true })
            .getByRole("button", { name: "Explore ideas", exact: true }),
        )
        .toBeVisible();
    }
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
