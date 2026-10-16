import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import type { McpSnapshot } from "@rukie/shared";
import "../../src/theme.css";

const pending: McpSnapshot = {
  servers: [
    {
      name: "global",
      scope: "user",
      configPath: "/mcp.json",
      transport: "stdio",
      status: "pending",
      tools: [],
      toolCount: 0,
      auth: "none",
    },
  ],
  configErrors: [],
};
const connected: McpSnapshot = {
  ...pending,
  servers: [{ ...pending.servers[0]!, status: "connected", toolCount: 2 }],
};

test("App observes global MCP before a Session, leases selected Project and follows Session scope", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  const fixture = (action: string, value: unknown) =>
    fetch(`http://127.0.0.1:${connection.port}/${action}`, {
      method: "POST",
      body: JSON.stringify(value),
    });
  const recorded = async (): Promise<
    { type: string; viewId?: string; active?: boolean; projectId?: string; sessionId?: string }[]
  > => (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
  await fixture("mcp", {
    "project:": pending,
    "project:project": connected,
    "session:one": connected,
  });
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const input = screen.getByRole("combobox", { name: "Prompt", exact: true });
  await expect
    .poll(async () => (await recorded()).find((command) => command.type === "mcp.subscribe"))
    .toMatchObject({ viewId: "composer:project:", active: false });
  await input.fill("/mcp");
  await expect
    .element(screen.getByRole("option", { name: "/mcp 1 MCP connecting", exact: true }))
    .toBeVisible();
  await fixture("message", {
    type: "mcp_status",
    viewId: "composer:project:",
    snapshot: connected,
  });
  await expect
    .element(
      screen.getByRole("option", { name: "/mcp 1 MCP connected · 2 tools available", exact: true }),
    )
    .toBeVisible();
  await userEvent.keyboard("{Tab}");
  await expect
    .poll(async () =>
      (await recorded()).filter((command) => command.type === "mcp.subscribe").at(-1),
    )
    .toMatchObject({ viewId: "composer:project:", active: true });
  await userEvent.keyboard("{Escape}{Escape}");
  await expect
    .poll(async () =>
      (await recorded()).filter((command) => command.type === "mcp.subscribe").at(-1),
    )
    .toMatchObject({ viewId: "composer:project:", active: false });
  await screen.getByRole("main").getByRole("button", { name: "Conversation", exact: true }).click();
  await screen.getByRole("menuitem", { name: "Project", exact: true }).click();
  await expect
    .poll(async () =>
      (await recorded()).filter((command) => command.type === "mcp.subscribe").at(-1),
    )
    .toMatchObject({ projectId: "project", active: true });
  await input.fill("/mcp");
  await expect
    .element(
      screen.getByRole("option", { name: "/mcp 1 MCP connected · 2 tools available", exact: true }),
    )
    .toBeVisible();
  expect((await recorded()).some((command) => command.type === "session.create")).toBe(false);
  await userEvent.keyboard("{Escape}");
  await screen
    .getByRole("button", { name: /Fix compiler/ })
    .first()
    .click();
  await expect
    .poll(async () =>
      (await recorded()).filter((command) => command.type === "mcp.subscribe").at(-1),
    )
    .toMatchObject({ sessionId: "one", active: true });
  await input.fill("/mcp");
  await expect
    .element(
      screen.getByRole("option", { name: "/mcp 1 MCP connected · 2 tools available", exact: true }),
    )
    .toBeVisible();
  await fixture("message", { type: "mcp_status", viewId: "composer:project:", snapshot: pending });
  await expect
    .element(
      screen.getByRole("option", { name: "/mcp 1 MCP connected · 2 tools available", exact: true }),
    )
    .toBeVisible();
  expect(
    (await recorded()).some(
      (command) =>
        command.type === "mcp.unsubscribe" && command.viewId === "composer:project:project",
    ),
  ).toBe(true);
  await screen.unmount();
});
