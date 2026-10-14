import { OVERLAY_LAYER } from "@/lib/overlay";
import * as React from "react";
import { cn } from "@/lib/utils";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

/** Radix blocks disabled selection; capture also blocks a caller's click callback. */
function menuItemClickCapture(
  disabled: boolean | undefined,
  onClickCapture: React.MouseEventHandler<HTMLDivElement> | undefined,
): React.MouseEventHandler<HTMLDivElement> {
  return (event) => {
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClickCapture?.(event);
  };
}

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          OVERLAY_LAYER.interactive,
          " max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-32 max-w-[calc(100vw-32px)] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto space-y-0.5 rounded-lg border border-popover-border bg-menu p-1 text-popover-foreground shadow-md duration-160 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group
      data-slot="dropdown-menu-group"
      className={cn("space-y-0.5", className)}
      {...props}
    />
  );
}

function DropdownMenuItem({
  className,
  disabled,
  onClickCapture,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <DropdownMenuPrimitive.Item
      disabled={disabled}
      onClickCapture={menuItemClickCapture(disabled, onClickCapture)}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-pointer items-center gap-2 rounded-md min-h-8 px-2 py-0 text-ui-base leading-[1.5] outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring select-none focus:bg-menu-hover focus:text-foreground not-data-[variant=destructive]:focus:**:text-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive-soft-foreground data-[variant=destructive]:focus:bg-destructive-soft data-[variant=destructive]:focus:text-destructive-soft-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:cursor-inherit [&_span]:cursor-inherit [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive-soft-foreground",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  disabled,
  onClickCapture,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      disabled={disabled}
      onClickCapture={menuItemClickCapture(disabled, onClickCapture)}
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-md min-h-8 py-0 pr-8 pl-2 text-ui-base leading-[1.5] outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring select-none focus:bg-menu-hover focus:text-foreground focus:**:text-foreground data-inset:pl-7 data-disabled:cursor-not-allowed data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:cursor-inherit [&_span]:cursor-inherit [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      className={cn("space-y-0.5", className)}
      {...props}
    />
  );
}

function DropdownMenuRadioItem({
  className,
  disabled,
  onClickCapture,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      disabled={disabled}
      onClickCapture={menuItemClickCapture(disabled, onClickCapture)}
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-md min-h-8 py-0 pr-8 pl-2 text-ui-base leading-[1.5] outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring select-none focus:bg-menu-hover focus:text-foreground focus:**:text-foreground data-inset:pl-7 data-disabled:cursor-not-allowed data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:cursor-inherit [&_span]:cursor-inherit [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "min-h-8 px-2 py-1 text-ui-sm font-medium text-muted-foreground data-inset:pl-7",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  disabled,
  onClickCapture,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      disabled={disabled}
      onClickCapture={menuItemClickCapture(disabled, onClickCapture)}
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-pointer data-disabled:cursor-not-allowed data-disabled:opacity-50 items-center gap-2 rounded-md min-h-8 px-2 py-0 text-ui-base leading-[1.5] outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring select-none focus:bg-menu-hover focus:text-foreground not-data-[variant=destructive]:focus:**:text-foreground data-inset:pl-7 data-open:bg-menu-hover data-open:text-foreground [&_svg]:pointer-events-none [&_svg]:cursor-inherit [&_span]:cursor-inherit [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        OVERLAY_LAYER.interactive,
        " min-w-[96px] origin-(--radix-dropdown-menu-content-transform-origin) max-h-[calc(100dvh-32px)] max-w-[calc(100vw-32px)] overflow-y-auto space-y-0.5 rounded-lg border border-popover-border bg-menu p-1 text-popover-foreground shadow-md duration-160 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
