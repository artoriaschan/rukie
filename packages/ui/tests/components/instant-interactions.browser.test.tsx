import { useState } from "react";
import { expect, test, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import { Button, ButtonLink } from "../../src/components/motion/button/base";
import { Checkbox } from "../../src/components/motion/checkbox";
import { RadioGroup, RadioGroupItem } from "../../src/components/motion/radio";
import { Switch } from "../../src/components/motion/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../src/components/motion/select";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "../../src/components/motion/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "../../src/components/ui/dropdown-menu";
import {
  MorphPopover,
  MorphPopoverTrigger,
  MorphPopoverContent,
} from "../../src/components/motion/popover-morph";
import { ActionSwapButton } from "../../src/components/motion/action-swap";
import { StatefulButton } from "../../src/components/motion/button/stateful";
import { PreviewRail } from "../../src/components/motion/preview-rail";
import { act } from "react";
import "../../src/theme.css";

function Controls({ action }: { action: () => void }) {
  const [checked, setChecked] = useState(false);
  const [on, setOn] = useState(false);
  return (
    <>
      <Button onClick={action}>Action</Button>
      <ButtonLink
        href="#instant"
        onClick={(event) => {
          event.preventDefault();
          action();
        }}
      >
        Link action
      </ButtonLink>
      <Checkbox label="Accept" checked={checked} onCheckedChange={setChecked} />
      <Switch label="Enable" checked={on} onCheckedChange={setOn} />
      <RadioGroup defaultValue="a" aria-label="Choice">
        <RadioGroupItem value="a" label="First" />
        <RadioGroupItem value="b" label="Second" />
      </RadioGroup>
    </>
  );
}

function expectImmediate(element: Element) {
  const style = getComputedStyle(element);
  expect(style.transitionDuration).toBe("0s");
  expect(style.animationName).toBe("none");
  expect(element.getAnimations({ subtree: true })).toHaveLength(0);
  expect(style.opacity).toBe("1");
  expect(style.clipPath).toBe("none");
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} normal-motion menus and submenus open at final geometry and close immediately`, async () => {
    const owner = ownProjectBrowserTest();
    await commands.reducedMotion(false);
    document.documentElement.className = theme;
    const action = vi.fn();
    const screen = await owner.render(
      <>
        <ContextMenu>
          <ContextMenuTrigger>
            <Button>Context actions</Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={action}>Context action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>More actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={action}>Dropdown action</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={action}>Destination</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        <Select defaultValue="a" onValueChange={action} className="w-64">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Alpha</SelectItem>
            <SelectItem value="b">Beta</SelectItem>
          </SelectContent>
        </Select>
        <MorphPopover>
          <MorphPopoverTrigger>
            <Button>Prompt actions</Button>
          </MorphPopoverTrigger>
          <MorphPopoverContent className="p-2">
            <Button onClick={action}>Attachment action</Button>
          </MorphPopoverContent>
        </MorphPopover>
      </>,
    );
    try {
      await screen
        .getByRole("button", { name: "Context actions", exact: true })
        .click({ button: "right" });
      const context = screen.getByRole("menu").element();
      expectImmediate(context);
      expect(context.getBoundingClientRect().width).toBe(224);
      expect(context.getBoundingClientRect().height).toBe(42);
      await userEvent.keyboard("{Enter}");
      expect(action).toHaveBeenCalledOnce();
      expect(getComputedStyle(context).visibility).toBe("hidden");
      expect(context.getAnimations({ subtree: true })).toHaveLength(0);
      await screen.getByRole("button", { name: "More actions", exact: true }).click();
      const menu = screen.getByRole("menu").element();
      expectImmediate(menu);
      await screen.getByRole("menuitem", { name: "Move", exact: true }).click();
      const submenu = document.querySelector('[data-slot="dropdown-menu-sub-content"]')!;
      expectImmediate(submenu);
      expect(submenu.getBoundingClientRect().height).toBe(42);
      await screen.getByRole("menuitem", { name: "Destination", exact: true }).click();
      expect(action).toHaveBeenCalledTimes(2);
      expect(menu.isConnected).toBe(false);
      expect(submenu.isConnected).toBe(false);
      const select = screen.getByRole("button", { name: "Alpha", exact: true });
      await select.click();
      const list = screen.getByRole("listbox").element();
      expectImmediate(list);
      expect(list.getBoundingClientRect().height).toBe(74);
      expectImmediate(select.element().querySelector("span[aria-hidden]")!);
      await screen.getByRole("option", { name: "Beta", exact: true }).click();
      expect(action).toHaveBeenLastCalledWith("b");
      expect(getComputedStyle(list).visibility).toBe("hidden");
      expect(list.getAnimations({ subtree: true })).toHaveLength(0);
      await screen.getByRole("button", { name: "Prompt actions", exact: true }).click();
      const popover = screen.getByRole("dialog").element();
      expectImmediate(popover);
      expectImmediate(popover.parentElement!);
      expect(popover.parentElement!.getBoundingClientRect().height).toBe(
        popover.getBoundingClientRect().height,
      );
      await userEvent.keyboard("{Escape}");
      expect(popover.isConnected).toBe(false);
    } finally {
      await owner.close();
    }
  });

  test(`${theme} pointer and keyboard activations update static control states without tap animations`, async () => {
    const owner = ownProjectBrowserTest();
    await commands.reducedMotion(false);
    document.documentElement.className = theme;
    const action = vi.fn();
    const screen = await owner.render(<Controls action={action} />);
    try {
      const button = screen.getByRole("button", { name: "Action", exact: true });
      const before = button.element().getBoundingClientRect().toJSON();
      let pointerActive = false;
      let pointerGeometry: ReturnType<DOMRect["toJSON"]> | undefined;
      let pointerDuration = "";
      let pointerAnimations = -1;
      const observe = () => {
        pointerActive = button.element().matches(":active");
        pointerGeometry = button.element().getBoundingClientRect().toJSON();
        pointerDuration = getComputedStyle(button.element()).transitionDuration;
        pointerAnimations = button.element().getAnimations({ subtree: true }).length;
      };
      button.element().addEventListener("pointerdown", observe);
      try {
        await button.click();
      } finally {
        button.element().removeEventListener("pointerdown", observe);
      }
      expect(pointerActive).toBe(true);
      expect(pointerGeometry).toEqual(before);
      expect(pointerDuration).toBe("0s");
      expect(pointerAnimations).toBe(0);
      await userEvent.keyboard("{Space>}");
      expectImmediate(button.element());
      expect(button.element().getBoundingClientRect().toJSON()).toEqual(before);
      await userEvent.keyboard("{/Space}");
      await screen.getByRole("link", { name: "Link action", exact: true }).click();
      expectImmediate(screen.getByRole("link", { name: "Link action", exact: true }).element());
      expect(action).toHaveBeenCalledTimes(3);
      const checkbox = screen.getByRole("checkbox", { name: "Accept", exact: true });
      await checkbox.click();
      expect(checkbox.element().getAttribute("aria-checked")).toBe("true");
      expectImmediate(checkbox.element());
      expect(getComputedStyle(checkbox.element()).backgroundColor).toBe(
        theme === "light" ? "rgb(23, 23, 23)" : "rgb(250, 250, 250)",
      );
      expect(checkbox.element().querySelector("path")!.getAttribute("stroke-dasharray")).toBeNull();
      const toggle = screen.getByRole("switch", { name: "Enable", exact: true });
      await toggle.click();
      expectImmediate(toggle.element());
      const thumb = toggle.element().firstElementChild!;
      expect(thumb.getBoundingClientRect().right).toBe(
        toggle.element().getBoundingClientRect().right - 2,
      );
      const radio = screen.getByRole("radio", { name: "First", exact: true });
      radio.element().focus();
      await userEvent.keyboard("{ArrowDown}");
      const second = screen.getByRole("radio", { name: "Second", exact: true });
      expect(second.element().getAttribute("aria-checked")).toBe("true");
      expect(second.element()).toBe(document.activeElement);
      expectImmediate(second.element());
      expect(
        screen.getByRole("radio", { name: "First", exact: true }).element().children,
      ).toHaveLength(0);
      expect(second.element().firstElementChild!.getBoundingClientRect().width).toBe(8);
    } finally {
      await owner.close();
    }
  });
  test(`${theme} pen tap reveals Preview Rail state immediately without changing its action`, async () => {
    const owner = ownProjectBrowserTest();
    await commands.reducedMotion(false);
    document.documentElement.className = theme;
    const action = vi.fn();
    const screen = await owner.render(
      <PreviewRail
        showPreview={false}
        onItemSelect={action}
        items={[
          { id: "one", label: "First Run" },
          { id: "two", label: "Second Run" },
        ]}
      />,
    );
    try {
      const second = screen.getByRole("button", { name: "Second Run", exact: true }).element();
      if (!(second instanceof HTMLButtonElement))
        throw new Error("Preview action must be a button");
      const tick = second.querySelector('[data-slot="preview-rail-tick"]')!;
      await act(() => {
        second.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, pointerType: "pen" }),
        );
        second.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, pointerId: 2, pointerType: "pen" }),
        );
        second.click();
      });
      expect(action).toHaveBeenCalledOnce();
      expect(action).toHaveBeenCalledWith(expect.objectContaining({ id: "two" }));
      expectImmediate(tick);
      expect(tick.getBoundingClientRect().width).toBe(48);
    } finally {
      await owner.close();
    }
  });
  test(`${theme} stateful and cycling button labels change immediately without click-feedback fades`, async () => {
    const owner = ownProjectBrowserTest();
    await commands.reducedMotion(false);
    document.documentElement.className = theme;
    const action = vi.fn();
    const screen = await owner.render(
      <>
        <ActionSwapButton
          items={[
            { id: "a", label: "First action" },
            { id: "b", label: "Second action" },
          ]}
          onValueChange={action}
        />
        <StatefulButton state="error" errorText="Retry action" onClick={action}>
          Idle action
        </StatefulButton>
      </>,
    );
    try {
      await screen.getByRole("button", { name: "First action", exact: true }).click();
      const next = screen.getByRole("button", { name: "Second action", exact: true }).element();
      expectImmediate(next);
      expect(getComputedStyle(next.firstElementChild!).opacity).toBe("1");
      expect(action).toHaveBeenCalledOnce();
      await screen.getByRole("button", { name: "Retry action", exact: true }).click();
      expect(action).toHaveBeenCalledTimes(2);
      expectImmediate(screen.getByRole("button", { name: "Retry action", exact: true }).element());
    } finally {
      await owner.close();
    }
  });
}
