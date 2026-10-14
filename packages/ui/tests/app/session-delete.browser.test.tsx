import { expect, test } from "vitest";
import { commands, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test.each(["en", "zh"] as const)(
  "%s deletion explains conversation workspace removal only for conversations",
  async (locale) => {
    await page.viewport(1280, 900);
    const connection = await commands.startWire();
    const screen = await render(
      <App
        locale={locale}
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      />,
    );
    try {
      const action = locale === "en" ? "Session actions" : "会话更多";
      const remove = locale === "en" ? "Permanently delete" : "永久删除";
      const cancel = locale === "en" ? "Cancel" : "取消";
      const description =
        locale === "en"
          ? "This cannot be undone. The chat, subagents, attachments and file history will be permanently removed."
          : "此操作不可撤销。聊天、子代理、附件和文件历史将被永久删除。";
      const workspace =
        locale === "en"
          ? "The chat’s working directory will also be deleted."
          : "对话的工作目录也会被删除。";
      for (const title of ["Fix compiler", "Explore ideas"]) {
        await screen.getByRole("button", { name: `${action} ${title}`, exact: true }).click();
        await screen.getByRole("menuitem", { name: remove, exact: true }).click();
        const dialog = screen.getByRole("dialog");
        await expect.element(dialog.getByText(title, { exact: true })).toBeVisible();
        await expect
          .element(
            dialog.getByText(
              description +
                (title === "Explore ideas" ? `${locale === "en" ? " " : ""}${workspace}` : ""),
              { exact: true },
            ),
          )
          .toBeVisible();
        await expect
          .element(dialog.getByRole("button", { name: cancel, exact: true }))
          .toHaveFocus();
        await dialog.getByRole("button", { name: cancel, exact: true }).click();
      }
    } finally {
      await screen.unmount();
      await commands.stopWire(connection.port);
    }
  },
);
