import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
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

function rgba(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const paint = canvas.getContext("2d");
  if (!paint) throw new Error("Canvas color conversion unavailable");
  paint.fillStyle = color;
  paint.fillRect(0, 0, 1, 1);
  return [...paint.getImageData(0, 0, 1, 1).data];
}

test.each([
  { locale: "en", width: 1280, dark: false },
  { locale: "zh", width: 420, dark: true },
] as const)(
  "worktree settings refresh, confirmation and busy retry preserve settings geometry ($locale)",
  async ({ locale, width, dark }) => {
    const owner = ownProjectBrowserTest();
    const connection = await owner.startWire();
    await page.viewport(width, 900);
    document.documentElement.classList.toggle("dark", dark);
    const tree = {
      id: "tree",
      projectId: "project",
      repository: "/project",
      branch: "rukie/worktree-long-branch",
      path: "/fixture-home/desktop-data/worktrees/tree/project",
      createdAt: 1,
    };
    await fixture(connection.port, "worktrees", [tree]);
    const screen = await owner.render(
      <App
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
        locale={locale}
      />,
    );
    const labels =
      locale === "en"
        ? {
            settings: "Model services",
            nav: "Worktrees",
            refresh: "Refresh",
            remove: "Delete",
            title: "Delete independent worktree",
            cancel: "Cancel",
            empty: "No independent worktrees",
            busy: "The bound Session is busy. Stop execution and finish pending confirmations before deleting this worktree.",
          }
        : {
            settings: "模型服务",
            nav: "工作树",
            refresh: "刷新",
            remove: "删除",
            title: "删除独立工作树",
            cancel: "取消",
            empty: "暂无独立工作树",
            busy: "绑定会话正在执行或等待确认，请结束后再删除工作树。",
          };
    await screen.getByRole("button", { name: labels.settings, exact: true }).click();
    const surface = screen.getByRole("region", { name: labels.settings, exact: true }).element();
    const regions = [
      surface,
      surface.querySelector(".model-services-navigation-scroll")!,
      surface.querySelector(".model-services-content-scroll")!,
      screen.getByRole("banner").element(),
    ];
    const baseline = regions.map((e) => e.getBoundingClientRect());
    await screen.getByRole("button", { name: labels.nav, exact: true }).click();
    await expect.element(screen.getByText(tree.branch, { exact: true })).toBeVisible();
    await expect.element(screen.getByText(tree.path, { exact: true })).toBeVisible();
    regions.forEach((e, i) => {
      const box = e.getBoundingClientRect();
      for (const key of ["x", "y", "width", "height"] as const)
        expect(Math.abs(box[key] - baseline[i]![key])).toBeLessThanOrEqual(1);
    });
    const refresh = screen.getByRole("button", { name: labels.refresh, exact: true });
    expect(getComputedStyle(refresh.element()).cursor).toBe("pointer");
    expect(getComputedStyle(refresh.element().querySelector("svg")!).cursor).toBe("pointer");
    await refresh.click();
    await screen.getByRole("button", { name: labels.remove, exact: true }).click();
    const dialog = screen.getByRole("dialog", { name: labels.title, exact: true });
    await expect.element(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: labels.remove, exact: true });
    const background = dark ? "rgba(255, 92, 92, 0.15)" : "rgb(253, 232, 232)";
    const foreground = dark ? "rgb(255, 122, 122)" : "rgb(207, 34, 46)";
    expect(getComputedStyle(confirm.element()).backgroundColor).toBe(background);
    expect(getComputedStyle(confirm.element()).color).toBe(foreground);
    expect(confirm.element().getBoundingClientRect().height).toBe(36);
    expect(
      dialog
        .getByRole("button", { name: labels.cancel, exact: true })
        .element()
        .getBoundingClientRect().height,
    ).toBe(32);
    expect(getComputedStyle(confirm.element()).cursor).toBe("pointer");
    await confirm.hover();
    const hover = rgba(getComputedStyle(confirm.element()).backgroundColor);
    const expectedHover = dark ? [255, 92, 92, 30] : [253, 232, 232, 204];
    // Canvas premultiplies translucent RGB channels; permit its byte-rounding error.
    hover.forEach((channel, index) =>
      expect(Math.abs(channel - expectedHover[index]!)).toBeLessThanOrEqual(2),
    );
    expect(getComputedStyle(confirm.element()).color).toBe(foreground);
    await dialog.getByRole("heading", { name: labels.title, exact: true }).hover();
    const description =
      locale === "en"
        ? `Delete ${tree.path} (including uncommitted changes), keep branch ${tree.branch}; bound Sessions will return to the primary Project folder.`
        : `将删除 ${tree.path}（含未提交改动），分支 ${tree.branch} 保留；绑定它的会话会回到主项目目录。`;
    await expect.element(dialog.getByText(description, { exact: true })).toBeVisible();
    await expect
      .element(dialog.getByRole("button", { name: labels.cancel, exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await screen.getByRole("button", { name: labels.remove, exact: true }).click();
    await dialog.getByRole("button", { name: labels.cancel, exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    await screen.getByRole("button", { name: labels.remove, exact: true }).click();
    await fixture(connection.port, "error", { type: "worktree.delete", code: "session_busy" });
    await confirm.click();
    await expect.element(dialog.getByRole("alert")).toHaveTextContent(labels.busy);
    const bounds = dialog.element().getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    await fixture(connection.port, "error", {
      type: "worktree.delete",
      code: "worktree_failed",
      params: { message: "repository unavailable" },
    });
    await confirm.click();
    await expect
      .element(dialog.getByRole("alert"))
      .toHaveTextContent(
        locale === "en"
          ? "Could not delete this worktree: repository unavailable"
          : "无法删除工作树：repository unavailable",
      );
    await fixture(connection.port, "hold", {});
    await confirm.click();
    await expect.element(confirm).toBeDisabled();
    expect(getComputedStyle(confirm.element()).backgroundColor).toBe(background);
    expect(getComputedStyle(confirm.element()).color).toBe(foreground);
    expect(getComputedStyle(confirm.element()).cursor).toBe("not-allowed");
    await userEvent.keyboard("{Enter}");
    await fixture(connection.port, "flush", {});
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(screen.getByText(labels.empty, { exact: true })).toBeVisible();
    const commands = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(commands.filter((c: { type: string }) => c.type === "worktree.delete")).toHaveLength(3);
    expect(commands.filter((c: { type: string }) => c.type === "worktrees.refresh")).toHaveLength(
      1,
    );
  },
);
