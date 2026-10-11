import * as React from "react";
import { cn } from "@/lib/utils";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { TranscriptScrollbar } from "../transcript-scrollbar";

function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportLabel,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string;
  viewportLabel?: string;
}) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      type="auto"
      className={cn("relative min-h-0 min-w-0 overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewport}
        id={id}
        style={{ overflowY: "auto" }}
        data-slot="scroll-area-viewport"
        aria-label={viewportLabel}
        tabIndex={0}
        className="size-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className={viewportClassName}>{children}</div>
      </ScrollAreaPrimitive.Viewport>
      <TranscriptScrollbar
        viewport={viewport}
        label={viewportLabel ?? props["aria-label"]}
        className="w-2 [&>div]:left-0.5 [&>div]:right-0.5 [&>div]:bg-foreground/30"
      />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export { ScrollArea };
