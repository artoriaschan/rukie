// PROTOTYPE primitives written in shadcn/ui default style (button, badge, kbd classes),
// with DESIGN.md tokens and the text-ui-* scale. Real code installs them through the shadcn CLI.
import { clsx, type ClassValue } from "clsx";
import { FileText, Pencil, Search, SquareTerminal } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
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

export function Button({
  variant = "default",
  size = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
}) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-ui-base font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
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
 * shadcn's tooltip. Opens on hover or keyboard focus, closes on leave, blur, or Esc.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 300);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => {
        clearTimeout(timer.current);
        setOpen(true);
      }}
      onBlur={hide}
      onKeyDown={(e) => e.key === "Escape" && hide()}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span id={id} role="tooltip" className="pointer-events-none absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-ui-sm whitespace-nowrap text-background shadow-md">
          {label}
        </span>
      )}
    </span>
  );
}
