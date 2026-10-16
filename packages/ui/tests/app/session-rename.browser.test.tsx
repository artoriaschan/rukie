import { expect, onTestFinished, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test("rename save keeps neutral inverse colors and geometry in both themes", async () => {
  const originalClass = document.documentElement.className;
  onTestFinished(() => {
    document.documentElement.className = originalClass;
  });
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    await screen
      .getByRole("button", { name: "Session actions Explore ideas", exact: true })
      .click();
    await screen.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const dialog = screen.getByRole("dialog", { name: "Rename chat", exact: true });
    const input = dialog.getByRole("textbox", { name: "Chat title", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await input.fill("Changed title");
    await expect.element(save).toBeEnabled();
    const bounds = save.element().getBoundingClientRect();
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
      const fill = dark ? "rgb(250, 250, 250)" : "rgb(23, 23, 23)";
      const text = dark ? "rgb(10, 10, 10)" : "rgb(255, 255, 255)";
      await input.hover();
      await expect.poll(() => getComputedStyle(save.element()).backgroundColor).toBe(fill);
      await expect.poll(() => getComputedStyle(save.element()).color).toBe(text);
      await save.hover();
      await expect.poll(() => getComputedStyle(save.element()).backgroundColor).toBe(fill);
      cancel.element().focus();
      await userEvent.keyboard("{Tab}");
      await expect.element(save).toHaveFocus();
      expect(save.element().matches(":focus-visible")).toBe(true);
      expect(getComputedStyle(save.element()).boxShadow).toContain("2px");
      expect(save.element().getBoundingClientRect().width).toBe(bounds.width);
      expect(save.element().getBoundingClientRect().height).toBe(bounds.height);
      await input.fill("Explore ideas");
      await expect.element(save).toBeDisabled();
      expect(getComputedStyle(save.element()).cursor).toBe("not-allowed");
      await input.fill("Changed title");
      await expect.element(save).toBeEnabled();
    }
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
    document.documentElement.className = originalClass;
  }
});

test("rename dialog selects the current title, disables invalid saves and Enter saves without opening the Session", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    const more = screen.getByRole("button", { name: "Session actions Explore ideas", exact: true });
    await more.click();
    await screen.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const dialog = screen.getByRole("dialog", { name: "Rename chat", exact: true });
    await expect.element(dialog).toBeVisible();
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Close modal", exact: true }).element())
        .cursor,
    ).toBe("pointer");
    await expect.element(dialog.getByText("Keep it short and recognizable")).toBeVisible();
    const input = dialog.getByRole("textbox", { name: "Chat title", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await expect.element(input).toHaveFocus();
    expect((input.element() as HTMLInputElement).selectionStart).toBe(0);
    expect((input.element() as HTMLInputElement).selectionEnd).toBe(13);
    await expect.element(save).toBeDisabled();
    expect(getComputedStyle(save.element()).cursor).toBe("not-allowed");
    const saveBounds = save.element().getBoundingClientRect();
    expect(
      document
        .elementFromPoint(saveBounds.x + saveBounds.width / 2, saveBounds.y + saveBounds.height / 2)
        ?.closest("button"),
    ).toBe(save.element());
    await save.click({ force: true });
    await expect.element(dialog).toBeVisible();
    await input.fill("   ");
    await expect.element(save).toBeDisabled();
    await input.fill("  Explore ideas  ");
    await expect.element(save).toBeDisabled();
    await input.fill("  My chosen title  ");
    await userEvent.keyboard("{Enter}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "My chosen title", exact: true }))
      .toBeVisible();
    const sent = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(
      sent.filter((command: { type: string }) => command.type === "session.rename"),
    ).toMatchObject([{ sessionId: "two", title: "My chosen title" }]);
    expect(sent.some((command: { type: string }) => command.type === "session.subscribe")).toBe(
      false,
    );
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("right-click, row-more and titlebar rename entries cancel with Escape, Cancel or close", async () => {
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
    await row.click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Rename", exact: true }).click();
    let dialog = screen.getByRole("dialog", { name: "Rename chat", exact: true });
    await dialog.getByRole("textbox").fill("Discard Escape");
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await screen
      .getByRole("button", { name: "Session actions Explore ideas", exact: true })
      .click();
    await screen.getByRole("menuitem", { name: "Rename", exact: true }).click();
    dialog = screen.getByRole("dialog", { name: "Rename chat", exact: true });
    await dialog.getByRole("textbox").fill("Discard Cancel");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    await row.click();
    await screen.getByRole("button", { name: "Session actions", exact: true }).click();
    await screen.getByRole("menuitem", { name: "Rename", exact: true }).click();
    dialog = screen.getByRole("dialog", { name: "Rename chat", exact: true });
    await dialog.getByRole("textbox").fill("Discard close");
    await dialog.getByRole("button", { name: "Close rename chat", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("heading", { name: "Explore ideas", exact: true }))
      .toBeVisible();
    const sent = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(sent.some((command: { type: string }) => command.type === "session.rename")).toBe(false);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("rename failures retain the draft and submitting prevents duplicate keyboard or pointer saves", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="zh"
    />,
  );
  try {
    await screen.getByRole("button", { name: "会话更多 Explore ideas", exact: true }).click();
    await screen.getByRole("menuitem", { name: "重命名", exact: true }).click();
    const dialog = screen.getByRole("dialog", { name: "重命名聊天", exact: true });
    await expect.element(dialog.getByText("保持简短且易于识别")).toBeVisible();
    const input = dialog.getByRole("textbox", { name: "聊天标题", exact: true });
    await input.fill("我的标题");
    const url = `http://127.0.0.1:${connection.port}`;
    const fail = async (code: string) =>
      fetch(`${url}/error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "session.rename", code }),
      });
    await fail("internal");
    await userEvent.keyboard("{Enter}");
    await expect.element(dialog.getByRole("alert")).toHaveTextContent("无法完成此操作，请重试。");
    await expect.element(input).toHaveValue("我的标题");
    await fail("session_busy");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect.element(dialog.getByRole("alert")).toHaveTextContent("会话被占用");
    await expect.element(input).toHaveValue("我的标题");
    await fetch(`${url}/hold`);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect.element(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    await userEvent.keyboard("{Enter}{Enter}");
    const sent = await (await fetch(`${url}/commands`)).json();
    expect(
      sent.filter((command: { type: string }) => command.type === "session.rename"),
    ).toHaveLength(3);
    await fetch(`${url}/flush`);
    await expect.element(dialog).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "我的标题", exact: true }))
      .toBeVisible();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
