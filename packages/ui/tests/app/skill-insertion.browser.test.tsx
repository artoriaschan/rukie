import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import "../../src/theme.css";

test("new chat refreshes cached skill catalogs and sends selected skills through the wire", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  const setSkills = async (name: string) =>
    fetch(`http://127.0.0.1:${connection.port}/skills`, {
      method: "POST",
      body: JSON.stringify({
        "project:": [
          {
            name,
            description: "Global skill",
            scope: "user",
            filePath: `/skills/${name}/SKILL.md`,
          },
        ],
      }),
    });
  await setSkills("review");
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App host={{ getConnection: async () => connection, modelServices: modelServicesFixture }} />,
  );
  const input = screen.getByRole("combobox", { name: "Prompt", exact: true });
  await expect.element(input).toHaveAttribute("contenteditable", "true");
  await input.fill("/");
  await expect
    .element(screen.getByRole("option", { name: "review Global skill Global" }))
    .toBeVisible();
  await setSkills("build");
  await fetch(`http://127.0.0.1:${connection.port}/hold?type=skills.list`, { method: "POST" });
  await userEvent.keyboard("{Escape}");
  await input.fill("");
  await input.fill("/");
  await expect
    .element(screen.getByRole("option", { name: "review Global skill Global" }))
    .toBeVisible();
  await fetch(`http://127.0.0.1:${connection.port}/flush`, { method: "POST" });
  await screen.getByRole("option", { name: "build Global skill Global" }).click();
  await userEvent.keyboard("inspect{Enter}");
  await expect
    .poll(async () => {
      const commands = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
      return commands.find((command: { type: string }) => command.type === "session.create")?.text;
    })
    .toBe("/build inspect");
});

test("new chat Project selection refreshes the skill scope without creating a Session", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await fetch(`http://127.0.0.1:${connection.port}/skills`, {
    method: "POST",
    body: JSON.stringify({
      "project:": [
        {
          name: "global",
          description: "Global skill",
          scope: "user",
          filePath: "/skills/global/SKILL.md",
        },
      ],
      "project:project": [
        {
          name: "project",
          description: "Project skill",
          scope: "project",
          filePath: "/project/.agents/skills/project/SKILL.md",
        },
      ],
    }),
  });
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App host={{ getConnection: async () => connection, modelServices: modelServicesFixture }} />,
  );
  const main = screen.getByRole("main");
  const input = main.getByRole("combobox", { name: "Prompt", exact: true });
  await expect.element(input).toHaveAttribute("contenteditable", "true");
  await input.fill("/");
  await expect
    .element(screen.getByRole("option", { name: "global Global skill Global" }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await main.getByRole("button", { name: "Conversation", exact: true }).click();
  await screen.getByRole("menuitem", { name: "Project", exact: true }).click();
  await input.fill("");
  await input.fill("/");
  await expect
    .element(screen.getByRole("option", { name: "project Project skill Project" }))
    .toBeVisible();
  expect(screen.getByRole("option", { name: "global Global skill Global" }).query()).toBeNull();
  const commands = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
  expect(
    commands.some(
      (command: { type: string; projectId?: string }) =>
        command.type === "skills.list" && command.projectId === "project",
    ),
  ).toBe(true);
  expect(commands.some((command: { type: string }) => command.type === "session.create")).toBe(
    false,
  );
});

test("running Session uses its own skill catalog and submits token text as steering", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await fetch(`http://127.0.0.1:${connection.port}/skills`, {
    method: "POST",
    body: JSON.stringify({
      "session:one": [
        {
          name: "review",
          description: "Session skill",
          scope: "project",
          filePath: "/project/.agents/skills/review/SKILL.md",
        },
      ],
    }),
  });
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App host={{ getConnection: async () => connection, modelServices: modelServicesFixture }} />,
  );
  await screen
    .getByRole("button", { name: /Fix compiler/ })
    .first()
    .click();
  await fetch(`http://127.0.0.1:${connection.port}/message`, {
    method: "POST",
    body: JSON.stringify({ type: "run_start", sessionId: "one", inputs: [] }),
  });
  const input = screen.getByRole("combobox", { name: "Prompt", exact: true });
  await input.fill("/");
  await screen.getByRole("option", { name: "review Session skill Project" }).click();
  await userEvent.keyboard("inspect{Enter}");
  await expect
    .poll(async () => {
      const commands = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
      return commands.find((command: { type: string }) => command.type === "prompt");
    })
    .toMatchObject({ sessionId: "one", text: "/review inspect" });
});
