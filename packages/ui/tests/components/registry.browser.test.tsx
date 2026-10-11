import { expect, test, vi } from "vitest";
import { UiLocaleProvider } from "../../src/lib/i18n";
import { render } from "vitest-browser-react";
import { Popover, PopoverTrigger, PopoverContent } from "../../src/components/motion/popover";
import { ToolApproval } from "../../src/components/agents/tool-approval";
import { Button } from "../../src/components/motion/button/base";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "../../src/components/ui/dropdown-menu";
import { Message } from "../../src/components/agents/message";
import { Citation } from "../../src/components/agents/citations";
import { AgentProgress } from "../../src/components/agents/loading-states/agent-progress";
import "../../src/theme.css";

test("permission actions expose Chinese copy and invoke caller decisions", async () => {
  const approve = vi.fn();
  const deny = vi.fn();
  const screen = await render(
    <UiLocaleProvider locale="zh">
      <ToolApproval tool="bash" onApprove={approve} onDeny={deny} />
    </UiLocaleProvider>,
  );
  await expect.element(screen.getByText("需要批准")).toBeVisible();
  await screen.getByRole("button", { name: "允许一次" }).click();
  expect(approve).toHaveBeenCalledOnce();
  await screen.getByRole("button", { name: "拒绝" }).click();
  expect(deny).toHaveBeenCalledOnce();
});

test("menu and beUI button preserve independent typography and keyboard focus", async () => {
  const select = vi.fn();
  const screen = await render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">Menu</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={select}>Open project</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const trigger = screen.getByRole("button", { name: "Menu" });
  const triggerElement = trigger.element();
  expect(getComputedStyle(triggerElement).fontSize).toBe("12px");
  await trigger.click();
  const item = screen.getByRole("menuitem", { name: "Open project" });
  await expect.element(item).toBeVisible();
  expect(getComputedStyle(item.element()).fontSize).toBe("14px");
  await item.click();
  expect(select).toHaveBeenCalledOnce();
  await expect.element(trigger).toHaveFocus();
});

test("popover stays readable when its trigger is near the viewport edge", async () => {
  const screen = await render(
    <div style={{ position: "fixed", left: 8, top: 8 }}>
      <Popover defaultOpen>
        <PopoverTrigger>
          <Button>Context</Button>
        </PopoverTrigger>
        <PopoverContent>
          <section aria-label="Context details" className="w-60">
            <p>System, tools and messages</p>
            <Button>Done</Button>
          </section>
        </PopoverContent>
      </Popover>
    </div>,
  );
  const dialog = screen.getByRole("dialog", { name: "Context" });
  await expect.element(dialog).toBeVisible();
  await expect.poll(() => dialog.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
  expect(dialog.element().getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth - 8);
});

test("registry message, citation and progress accessible names use the injected locale", async () => {
  const screen = await render(
    <UiLocaleProvider locale="zh">
      <Message from="assistant">回复</Message>
      <Citation citationId="source" index={2} idPrefix="sources" />
      <AgentProgress label="检查代码" elapsedSeconds={1} />
    </UiLocaleProvider>,
  );
  try {
    await expect.element(screen.getByRole("article", { name: "助手消息" })).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "查看引用 2" })).toBeVisible();
    await expect.element(screen.getByRole("status", { name: "检查代码，进行中" })).toBeVisible();
  } finally {
    await screen.unmount();
  }
});
