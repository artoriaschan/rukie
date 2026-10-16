import { useState } from "react";
import { UiLocaleProvider } from "../../src/lib/i18n";
import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Composer } from "../../src/components/composer";
import type { McpSnapshot } from "@rukie/shared";
import "../../src/theme.css";

const snapshot: McpSnapshot = {
  configErrors: [{ scope: "project", path: "/project/.mcp.json", error: "Invalid JSON" }],
  servers: (["connected", "pending", "needs-auth", "failed", "project-required"] as const).map(
    (status) => ({
      name: status,
      status,
      scope: "user" as const,
      configPath: "/mcp.json",
      tools: [],
      toolCount: status === "connected" ? 12 : 0,
      auth: "none" as const,
      transport: "stdio" as const,
      ...(status === "failed" ? { error: "Connection refused" } : {}),
    }),
  ),
};

test("MCP summary enters read-only live status, filters and exits without sending", async () => {
  const sent = vi.fn();
  const leased = vi.fn();
  const screen = await render(
    <div style={{ width: 752, marginTop: 400 }}>
      <Composer
        draft=""
        onDraft={vi.fn()}
        mcpSnapshot={snapshot}
        onMcpOpenChange={leased}
        images={[]}
        onImages={vi.fn()}
        disabled={false}
        running={false}
        permissionMode="ask"
        onPermission={vi.fn()}
        planMode={false}
        onPlanMode={vi.fn()}
        models={[]}
        onModel={vi.fn()}
        onSend={sent}
        onStop={vi.fn()}
      />
    </div>,
  );
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/mcp");
    await expect
      .element(
        screen.getByRole("option", {
          name: /\/mcp.*1 MCP connected.*12 tools available.*1 MCP connecting.*1 MCP needs authorization.*1 MCP failed/,
        }),
      )
      .toBeVisible();
    await userEvent.keyboard("{Tab}");
    await expect.poll(() => input.element().textContent).toBe("/mcp ");
    const connected = screen.getByRole("option", {
      name: "connected Global · Connected · 12 tools",
      exact: true,
    });
    await expect.element(connected).toHaveAttribute("aria-disabled", "true");
    expect(getComputedStyle(connected.element()).cursor).toBe("not-allowed");
    await expect
      .element(
        screen.getByRole("option", {
          name: "project-required Global · Select a project to start",
          exact: true,
        }),
      )
      .toBeVisible();
    await expect.element(screen.getByRole("option", { name: /Invalid JSON/ })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    expect(sent).not.toHaveBeenCalled();
    await input.fill("/mcp FAIL");
    const failed = screen.getByRole("option", { name: "failed Global · Failed", exact: true });
    await expect.element(failed).toBeVisible();
    expect(failed.element().getAttribute("title")).toContain("Connection refused");
    expect(screen.getByRole("option").all()).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    await expect.element(input).toHaveTextContent("/");
    await userEvent.keyboard("{Escape}");
    await expect.element(input).toHaveTextContent("");
    expect(sent).not.toHaveBeenCalled();
    expect(leased.mock.calls).toEqual([[true], [false]]);
  } finally {
    await screen.unmount();
  }
});

function Fixture({
  value,
  locale = "en",
  opened = () => {},
}: {
  value?: McpSnapshot;
  locale?: "en" | "zh";
  opened?: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <UiLocaleProvider locale={locale}>
      <div style={{ width: "min(752px, calc(100vw - 32px))", marginTop: 400 }}>
        <Composer
          draft={draft}
          onDraft={setDraft}
          mcpSnapshot={value}
          onMcpOpenChange={opened}
          images={[]}
          onImages={vi.fn()}
          disabled={false}
          running={true}
          permissionMode="ask"
          onPermission={vi.fn()}
          planMode={false}
          onPlanMode={vi.fn()}
          models={[]}
          onModel={vi.fn()}
          onSend={vi.fn()}
          onStop={vi.fn()}
        />
      </div>
    </UiLocaleProvider>
  );
}

test("MCP loading becomes empty, zero counts hide and plus click stays usable during a Run", async () => {
  const screen = await render(<Fixture />);
  try {
    const input = screen.getByRole("combobox");
    await screen.getByRole("button", { name: "Attach images", exact: true }).click();
    const command = screen.getByRole("option", { name: "/mcp Loading", exact: true });
    await expect.element(command).toBeVisible();
    await command.click();
    await expect
      .element(screen.getByRole("option", { name: "Loading", exact: true }))
      .toHaveAttribute("aria-disabled", "true");
    await screen.rerender(<Fixture value={{ servers: [], configErrors: [] }} />);
    await expect
      .element(screen.getByRole("option", { name: "No MCP servers configured", exact: true }))
      .toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("option", { name: "/mcp No MCP configured", exact: true }))
      .toBeVisible();
    await userEvent.keyboard("{Enter}");
    await input.fill("/mcp missing");
    await expect
      .element(screen.getByRole("option", { name: "No matching MCP servers", exact: true }))
      .toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => input.element().textContent).toBe("/mcp missing");
    await input.fill("/mcp");
    await expect
      .element(screen.getByRole("option", { name: "/mcp No MCP configured", exact: true }))
      .toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => input.element().textContent).toBe("");
  } finally {
    await screen.unmount();
  }
});

test("MCP live rows localize in Chinese and preserve narrow composer geometry", async () => {
  const { page } = await import("vitest/browser");
  await page.viewport(390, 900);
  const screen = await render(
    <Fixture locale="zh" value={{ servers: [snapshot.servers[1]!], configErrors: [] }} />,
  );
  try {
    const input = screen.getByRole("combobox");
    const baseline = input.element().closest("form")!.getBoundingClientRect().toJSON();
    await input.fill("/mcp");
    await expect
      .element(screen.getByRole("option", { name: "/mcp 1个MCP连接中", exact: true }))
      .toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("option", { name: "pending 全局 · 连接中", exact: true }))
      .toBeVisible();
    await screen.rerender(
      <Fixture
        locale="zh"
        value={{
          servers: [{ ...snapshot.servers[0]!, name: "pending", scope: "project" }],
          configErrors: [],
        }}
      />,
    );
    await expect
      .element(
        screen.getByRole("option", { name: "pending 项目 · 已连接 · 12个工具", exact: true }),
      )
      .toBeVisible();
    expect(input.element().closest("form")!.getBoundingClientRect().toJSON()).toEqual(baseline);
    expect(input.element().getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option").element().id,
    );
    await expect.element(input).toHaveFocus();
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test("long MCP summaries truncate within a narrow row and expose the full hint", async () => {
  const { page } = await import("vitest/browser");
  await page.viewport(390, 900);
  const screen = await render(<Fixture value={snapshot} />);
  try {
    await screen.getByRole("combobox").fill("/mcp");
    const row = screen.getByRole("option", { name: /^\/mcp 1 MCP connected/ });
    await expect.element(row).toBeVisible();
    const option = row.element();
    const scope = option.querySelector<HTMLElement>(".composer-insertion-scope")!;
    expect(option.getBoundingClientRect().width).toBeLessThanOrEqual(358);
    expect(scope.getBoundingClientRect().right).toBeLessThanOrEqual(
      option.getBoundingClientRect().right - 8,
    );
    await expect.poll(() => scope.scrollWidth > scope.clientWidth).toBe(true);
    expect(getComputedStyle(scope).textOverflow).toBe("ellipsis");
    expect(scope.title).toBe(
      "1 MCP connected · 12 tools available · 1 MCP connecting · 1 MCP needs authorization · 1 MCP failed",
    );
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test("leaving MCP by pointer clears the view command and later Escape preserves ordinary drafts", async () => {
  const screen = await render(
    <>
      <Fixture value={snapshot} />
      <button>Outside</button>
    </>,
  );
  try {
    const input = screen.getByRole("combobox");
    await input.fill("/mcp ");
    await expect
      .element(screen.getByRole("group", { name: "MCP servers", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Outside", exact: true }).click();
    await expect.poll(() => input.element().textContent).toBe("");
    await input.fill("/mcp ");
    await userEvent.keyboard("{Escape}");
    await input.fill("Keep this ordinary draft");
    await screen.getByRole("button", { name: "Attach images", exact: true }).click();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => input.element().textContent).toBe("Keep this ordinary draft");
  } finally {
    await screen.unmount();
  }
});
