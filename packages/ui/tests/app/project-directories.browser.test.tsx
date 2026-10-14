import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

const requests = async (port: number): Promise<Record<string, unknown>[]> =>
  (await fetch(`http://127.0.0.1:${port}/commands`)).json();

test("multiple folders choose first primary, focus reveals primary action and cancellation sends nothing", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      locale="en"
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: async () => ["/first", "/second"],
      }}
    />,
  );
  try {
    await expect
      .element(screen.getByRole("button", { name: "Add project", exact: true }))
      .toBeInTheDocument();
    const main = screen.getByRole("main").element();
    const baseline = main.getBoundingClientRect();
    await screen.getByRole("button", { name: "Add project", exact: true }).click();
    await expect.element(screen.getByText("/first", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Primary", { exact: true })).toBeVisible();
    const primary = screen.getByRole("button", { name: "Set as primary /second", exact: true });
    expect(getComputedStyle(primary.element()).opacity).toBe("0");
    primary.element().focus();
    await userEvent.keyboard("{Enter}");
    await screen.getByRole("button", { name: "Create project", exact: true }).click();
    await expect
      .element(screen.getByRole("dialog", { name: "Trust these folders?", exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "The primary folder's project instructions, hooks, MCP configuration and allow rules will take effect.",
          { exact: true },
        ),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByText("Additional folders' project instructions will be loaded.", {
          exact: true,
        }),
      )
      .toBeVisible();
    expect(main.getBoundingClientRect().left).toBe(baseline.left);
    expect(main.getBoundingClientRect().width).toBe(baseline.width);
    await screen.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.create" }),
    );
    await screen.getByRole("button", { name: "Add project", exact: true }).click();
    await screen.getByRole("button", { name: "Create project", exact: true }).click();
    await screen.getByRole("button", { name: "Trust and create", exact: true }).click();
    await expect
      .poll(() => requests(connection.port))
      .toContainEqual(
        expect.objectContaining({
          type: "project.create",
          directories: ["/first", "/second"],
          trusted: true,
        }),
      );
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
    await expect
      .element(
        screen.getByRole("heading", { name: "What should we build in Cross repo?", exact: true }),
      )
      .toBeVisible();
    expect(await requests(connection.port)).not.toContainEqual(
      expect.objectContaining({ type: "project.create" }),
    );
    await screen.getByRole("main").getByRole("button", { name: "Cross repo", exact: true }).click();
    await screen.getByRole("menuitem", { name: "Project directories", exact: true }).click();
    const setPrimary = screen.getByRole("button", { name: "Set as primary /second", exact: true });
    await setPrimary.hover();
    expect(getComputedStyle(setPrimary.element()).opacity).toBe("1");
    await setPrimary.click();
    await expect
      .poll(() => requests(connection.port))
      .toContainEqual(
        expect.objectContaining({
          type: "project.setPrimary",
          projectId: "project",
          directory: "/second",
        }),
      );
    await screen.getByRole("button", { name: "Cancel", exact: true }).click();
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
  test(`${code} displays a localized creation error without closing confirmation`, async () => {
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
      await screen.getByRole("button", { name: "Create project", exact: true }).click();
      await fetch(`http://127.0.0.1:${connection.port}/error`, {
        method: "POST",
        body: JSON.stringify({ type: "project.create", code, params: { project: "Other repo" } }),
      });
      await screen.getByRole("button", { name: "Trust and create", exact: true }).click();
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
