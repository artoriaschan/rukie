import { expect, test } from "vitest";
import { page } from "vitest/browser";
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
async function commands(port: number) {
  return (await (await fetch(`http://127.0.0.1:${port}/commands`)).json()) as {
    type: string;
    [key: string]: unknown;
  }[];
}

test("new chat preserves plan preselection after failure and creates its first Run in plan mode", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const add = screen.getByRole("button", { name: "Attach images", exact: true });
  await expect.element(add).toBeEnabled();
  const composer = document.querySelector(".conversation-composer")!;
  const selector = document.querySelector(".new-chat-selector")!;
  const baseline = [composer, selector].map((item) => item.getBoundingClientRect().toJSON());
  await add.click();
  await screen.getByRole("menuitem", { name: "Plan mode Off", exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: "Close plan mode", exact: true }))
    .toBeVisible();
  expect([composer, selector].map((item) => item.getBoundingClientRect().toJSON())).toEqual(
    baseline,
  );
  const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Draft the implementation plan");
  await fixture(connection.port, "error", { type: "session.create", code: "invalid_command" });
  await screen.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect.element(prompt).toHaveValue("Draft the implementation plan");
  await expect
    .element(screen.getByRole("button", { name: "Close plan mode", exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await commands(connection.port)).filter((command) => command.type === "session.create")
          .length,
    )
    .toBe(2);
  const creation = (await commands(connection.port)).filter(
    (command) => command.type === "session.create",
  );
  for (const command of creation)
    expect(command).toMatchObject({
      text: "Draft the implementation plan",
      planMode: true,
      permissionMode: "ask",
    });
});

test.each([
  {
    locale: "en",
    width: 1280,
    dark: false,
    attach: "Attach images",
    off: "Plan mode Off",
    on: "Plan mode • On",
    close: "Close plan mode",
    prompt: "Prompt",
  },
  {
    locale: "zh",
    width: 420,
    dark: true,
    attach: "添加图片",
    off: "计划模式 已关闭",
    on: "计划模式 • 已开启",
    close: "关闭计划模式",
    prompt: "输入消息",
  },
] as const)(
  "existing Session plan state follows snapshots and Tool State ($locale, $width)",
  async (copy) => {
    const owner = ownProjectBrowserTest();
    const connection = await owner.startWire();
    await page.viewport(1280, 900);
    document.documentElement.classList.toggle("dark", copy.dark);
    const screen = await owner.render(
      <App
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
        locale={copy.locale}
      />,
    );
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await page.viewport(copy.width, 900);
    if (copy.width < 768)
      await screen.getByRole("button", { name: "切换侧栏", exact: true }).click();
    const send = (value: object) =>
      fixture(connection.port, "message", { sessionId: "one", ...value });
    const close = screen.getByRole("button", { name: copy.close, exact: true });
    await expect.element(close).not.toBeInTheDocument();
    const prompt = screen.getByRole("textbox", { name: copy.prompt, exact: true });
    await prompt.fill("Preserved Session draft");
    await send({
      type: "snapshot",
      model: "test/script",
      messages: [],
      compactions: [],
      toolStates: {},
      planMode: true,
      permissionMode: "ask",
    });
    await expect.element(close).toBeVisible();
    await close.click();
    await expect
      .poll(async () =>
        (await commands(connection.port)).some(
          (command) =>
            command.type === "session.set_plan_mode" &&
            command.sessionId === "one" &&
            command.on === false,
        ),
      )
      .toBe(true);
    await send({ type: "tool_state_changed", name: "plan", value: { active: false } });
    await expect.element(close).not.toBeInTheDocument();
    await expect.element(prompt).toHaveValue("Preserved Session draft");
    await screen.getByRole("button", { name: copy.attach, exact: true }).click();
    await screen.getByRole("menuitem", { name: copy.off, exact: true }).click();
    await expect
      .poll(async () =>
        (await commands(connection.port)).some(
          (command) =>
            command.type === "session.set_plan_mode" &&
            command.sessionId === "one" &&
            command.on === true,
        ),
      )
      .toBe(true);
    await send({ type: "tool_state_changed", name: "plan", value: { active: true } });
    await expect.element(close).toBeVisible();
    await close.hover();
    expect(
      getComputedStyle(close.element().querySelector(".conversation-plan-close")!).visibility,
    ).toBe("visible");
    expect(getComputedStyle(close.element().querySelector(".conversation-plan-close")!).color).toBe(
      copy.dark ? "rgb(43, 43, 43)" : "rgb(255, 255, 255)",
    );
    await screen.getByRole("button", { name: copy.attach, exact: true }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: copy.on, exact: true }))
      .toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  },
);

test("enter_plan_mode approval projects the resulting Tool State into C39", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  await screen
    .getByRole("button", { name: /Fix compiler/ })
    .first()
    .click();
  const send = (value: object) =>
    fixture(connection.port, "message", { sessionId: "one", ...value });
  const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Keep the draft during approval");
  const identity = { epoch: "enter-plan", requestId: "run", taskId: 1, conversationId: 1 };
  await send({
    type: "interaction_requested",
    identity,
    request: {
      kind: "permission",
      identity,
      toolName: "enter_plan_mode",
      toolCallId: "enter",
      args: {},
      mode: "ask",
      reason: "Plan this change",
      sessionAllow: { kind: "tool", rule: "enter_plan_mode" },
    },
  });
  await screen.getByRole("button", { name: "Allow", exact: true }).click();
  await expect
    .poll(async () =>
      (await commands(connection.port)).some(
        (command) =>
          command.type === "interaction.reply" &&
          command.kind === "permission" &&
          command.reply === "allow",
      ),
    )
    .toBe(true);
  // The fixture scripts the Core result at the public wire boundary; ticket02 owns Core execution.
  await send({ type: "tool_state_changed", name: "plan", value: { active: true } });
  await expect
    .element(screen.getByRole("button", { name: "Close plan mode", exact: true }))
    .toBeVisible();
  await expect.element(prompt).toHaveValue("Keep the draft during approval");
  expect(
    screen.getByRole("button", { name: "Permission mode", exact: true }).element().textContent,
  ).toContain("Ask");
});
