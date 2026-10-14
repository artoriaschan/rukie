import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../src/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../src/components/motion/select";
import { Button } from "../../src/components/motion/button/base";
import { Tooltip } from "../../src/components/motion/tooltip";
import "../../src/theme.css";

test("compact menu groups preserve row spacing, shadow, and action focus restoration", async () => {
  const action = vi.fn();
  const screen = await render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={action}>Open project</DropdownMenuItem>
          <DropdownMenuItem>Open session</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const trigger = screen.getByRole("button", { name: "Actions" });
  await trigger.click();
  const item = screen.getByRole("menuitem", { name: "Open project" });
  await expect.element(item).toBeVisible();
  const menu = screen.getByRole("menu").element();
  expect(getComputedStyle(menu).padding).toBe("4px");
  expect(getComputedStyle(menu).borderRadius).toBe("8px");
  expect(getComputedStyle(menu).zIndex).toBe("60");
  expect(getComputedStyle(menu).boxShadow).not.toBe("none");
  expect(getComputedStyle(item.element()).height).toBe("32px");
  expect(getComputedStyle(item.element()).paddingLeft).toBe("8px");
  const next = screen.getByRole("menuitem", { name: "Open session" }).element();
  await expect
    .poll(() => next.getBoundingClientRect().top - item.element().getBoundingClientRect().bottom)
    .toBe(2);
  await item.click();
  expect(action).toHaveBeenCalledOnce();
  await expect.element(trigger).toHaveFocus();
});

test("compact Select clamps long options and keeps selected label after choosing", async () => {
  const chosen = vi.fn();
  const screen = await render(
    <Select onValueChange={chosen} defaultValue="0" className="w-64">
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 30 }, (_, index) => (
          <SelectItem key={index} value={String(index)}>
            {`Option ${index}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>,
  );
  const trigger = screen.getByRole("button", { name: "Option 0" });
  await expect.element(trigger).toBeVisible();
  expect(getComputedStyle(trigger.element()).height).toBe("32px");
  await trigger.click();
  const list = screen.getByRole("listbox");
  await expect.element(list).toBeVisible();
  await expect.poll(() => list.element().getBoundingClientRect().height).toBeLessThanOrEqual(320);
  const option = screen.getByRole("option", { name: "Option 1", exact: true });
  expect(getComputedStyle(option.element()).height).toBe("32px");
  await option.click();
  expect(chosen).toHaveBeenCalledWith("1");
  await expect.element(screen.getByRole("button", { name: "Option 1" })).toBeVisible();
  await expect.element(list).not.toBeInTheDocument();
});

test("ordinary hints retain F01 padding without moving their trigger", async () => {
  const screen = await render(
    <Tooltip content="Action hint" open>
      <Button variant="ghost">Hint trigger</Button>
    </Tooltip>,
  );
  try {
    const trigger = screen.getByRole("button", { name: "Hint trigger", exact: true }).element();
    const bounds = trigger.getBoundingClientRect().toJSON();
    const hint = screen.getByRole("tooltip");
    await expect.element(hint).toBeVisible();
    expect(getComputedStyle(hint.element()).padding).toBe("8px");
    expect(trigger.getBoundingClientRect().toJSON()).toEqual(bounds);
  } finally {
    await screen.unmount();
  }
});
