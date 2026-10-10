// PROTOTYPE primitives written in shadcn/ui default style (button, badge, kbd classes),
// with DESIGN.md tokens and the text-ui-* scale. Real code installs them through the shadcn CLI.
import { clsx, type ClassValue } from "clsx";
import { FileText, Pencil, Search, SquareTerminal } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ "text-ui": ["xs", "sm", "base", "lg", "xl"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const buttonVariants = {
  default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
  outline: "border border-border-strong bg-background shadow-xs hover:bg-card",
  secondary: "bg-card text-foreground hover:bg-card/80 border border-border",
  ghost: "hover:bg-card text-foreground",
  destructive: "bg-destructive text-white shadow-xs hover:bg-destructive/90",
};

const buttonSizes = {
  default: "h-9 px-4 py-2 gap-2",
  sm: "h-8 px-3 gap-1.5",
  xs: "h-7 px-2 gap-1 text-ui-sm",
  icon: "size-9",
  "icon-sm": "size-8",
};

/** `tip` labels an icon-only button: it becomes the accessible name and a hover/focus tooltip. */
export function Button({
  variant = "default",
  size = "default",
  className,
  tip,
  tipSide,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  tip?: string;
  tipSide?: "top" | "bottom" | "right";
}) {
  const button = (
    <button
      aria-label={tip}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-ui-base font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
  return tip ? (
    <Tooltip label={tip} side={tipSide}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

const badgeVariants = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-transparent bg-card text-foreground",
  outline: "text-foreground",
  success: "text-success border-success/40",
  danger: "text-danger border-danger/40",
  warning: "text-warning border-warning/40",
};

export function Badge({ variant = "outline", className, children }: { variant?: keyof typeof badgeVariants; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-ui-sm font-medium whitespace-nowrap [&_svg]:size-3", badgeVariants[variant], className)}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-card px-1 font-mono text-ui-xs text-muted-foreground border">{children}</kbd>;
}

/** Renders `code` spans in mono; stands in for the micromark renderer. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") ? (
          <code key={i} className="rounded-sm bg-card px-1 py-0.5 font-mono text-ui-sm border">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export const toolIcons = { Read: FileText, Bash: SquareTerminal, Edit: Pencil, Grep: Search };

/**
 * PROTOTYPE tooltip in shadcn/ui Tooltip style (inverted pill, short delay); real code installs
 * shadcn's tooltip. Opens on hover or keyboard focus, closes on leave, blur, press, or Esc.
 * Rendered in a portal so scroll containers and overflow-hidden sheets cannot clip it.
 */
export function Tooltip({ label, side = "bottom", children }: { label: string; side?: "top" | "bottom" | "right"; children: ReactNode }) {
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const open = () => box.current && setAt(box.current.getBoundingClientRect());
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(open, 300);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setAt(null);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const style =
    at &&
    (side === "right"
      ? { top: at.top + at.height / 2, left: at.right + 8, transform: "translateY(-50%)" }
      : side === "top"
        ? { top: at.top - 8, left: at.left + at.width / 2, transform: "translate(-50%, -100%)" }
        : { top: at.bottom + 8, left: at.left + at.width / 2, transform: "translateX(-50%)" });
  return (
    <span
      ref={box}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => e.target.matches(":focus-visible") && open()}
      onBlur={hide}
      onKeyDown={(e) => e.key === "Escape" && hide()}
      aria-describedby={at ? id : undefined}
    >
      {children}
      {style &&
        createPortal(
          <span id={id} role="tooltip" style={style} className="pointer-events-none fixed z-[60] rounded-md bg-foreground px-3 py-1.5 text-ui-sm whitespace-nowrap text-background shadow-md">
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

/**
 * PROTOTYPE popover in shadcn/ui Popover style; real code installs shadcn's popover. Opens above
 * `anchor` aligned to its start edge, kept inside the viewport; closes on outside press or Esc.
 */
export function Popover({ anchor, label, onClose, children }: { anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const p = root.current?.getBoundingClientRect();
    if (!p) return;
    const top = a.top - 8 - p.height < 8 ? a.bottom + 8 : a.top - 8 - p.height;
    setPos({ top, left: Math.min(Math.max(8, a.left - 8), innerWidth - p.width - 8) });
  }, [anchor]);
  useEffect(() => {
    const outside = (e: MouseEvent) => !root.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose();
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
      anchor.focus();
    };
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={root} role="dialog" aria-label={label} style={pos ?? { top: 0, left: 0 }} className={cn("fixed z-50 rounded-xl border bg-popover p-4 text-foreground shadow-md outline-none", !pos && "opacity-0")}>
      {children}
    </div>,
    document.body,
  );
}
