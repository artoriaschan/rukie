// PROTOTYPE dropdown menu in shadcn/ui DropdownMenu style (items, check items, labels,
// separators, submenus). Real code installs shadcn's dropdown-menu instead. Rendered in a portal
// with fixed positioning so scroll containers such as the sidebar cannot clip it.
import { Check, ChevronRight, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "./ui";

export type MenuEntry =
  | { kind: "item"; label: string; icon?: LucideIcon; onSelect: () => void }
  | { kind: "check"; label: string; checked: boolean; radio?: boolean; onSelect: () => void }
  | { kind: "sub"; label: string; icon?: LucideIcon; entries: MenuEntry[] }
  | { kind: "label"; label: string }
  | { kind: "separator" };

const panelClass = "min-w-56 rounded-md border bg-popover p-1 text-foreground shadow-md";
const itemClass = "relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-ui-base outline-none select-none focus:bg-card [&_svg]:size-4 [&_svg]:shrink-0";

function Panel({ entries, label, autoFocus, onDone, onBack }: { entries: MenuEntry[]; label: string; autoFocus: boolean; onDone: () => void; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ index: number; focus: boolean } | null>(null);
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>(":scope > div > [role^=menuitem]") ?? [])];

  useEffect(() => {
    if (autoFocus) items()[0]?.focus();
  }, [autoFocus]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={panelClass}
      onKeyDown={(e) => {
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (i < 0 && e.key !== "Escape") return;
        const move = (to: number) => {
          e.preventDefault();
          e.stopPropagation();
          list[(to + list.length) % list.length]?.focus();
        };
        if (e.key === "ArrowDown") move(i + 1);
        else if (e.key === "ArrowUp") move(i - 1);
        else if (e.key === "Home") move(0);
        else if (e.key === "End") move(list.length - 1);
        else if (e.key === "ArrowLeft" && onBack) {
          e.stopPropagation();
          onBack();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      {entries.map((entry, index) => {
        if (entry.kind === "separator") return <div key={index} role="separator" className="-mx-1 my-1 h-px bg-border" />;
        if (entry.kind === "label")
          return (
            <div key={index} className="px-2 py-1.5 text-ui-sm text-muted-foreground">
              {entry.label}
            </div>
          );
        const hover = (e: React.MouseEvent<HTMLElement>) => {
          e.currentTarget.focus();
          setSub(entry.kind === "sub" ? { index, focus: false } : null);
        };
        if (entry.kind === "sub") {
          const Icon = entry.icon;
          const open = sub?.index === index;
          return (
            <div key={index} className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
                onMouseEnter={hover}
                onClick={() => setSub(open ? null : { index, focus: true })}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setSub({ index, focus: true });
                  }
                }}
                className={cn(itemClass, open && "bg-card")}
              >
                {Icon && <Icon className="text-muted-foreground" />}
                <span className="flex-1">{entry.label}</span>
                <ChevronRight className="text-muted-foreground" />
              </button>
              {open && (
                <div className="absolute top-0 left-full z-10 -mt-1 pl-1">
                  <Panel
                    entries={entry.entries}
                    label={entry.label}
                    autoFocus={sub.focus}
                    onDone={onDone}
                    onBack={() => {
                      setSub(null);
                      items()[index]?.focus();
                    }}
                  />
                </div>
              )}
            </div>
          );
        }
        if (entry.kind === "check")
          return (
            <div key={index}>
              <button type="button" role={entry.radio ? "menuitemradio" : "menuitemcheckbox"} aria-checked={entry.checked} onMouseEnter={hover} onClick={entry.onSelect} className={itemClass}>
                <span className="flex-1">{entry.label}</span>
                {entry.checked && <Check />}
              </button>
            </div>
          );
        const Icon = entry.icon;
        return (
          <div key={index}>
            <button
              type="button"
              role="menuitem"
              onMouseEnter={hover}
              onClick={() => {
                entry.onSelect();
                onDone();
              }}
              className={itemClass}
            >
              {Icon && <Icon className="text-muted-foreground" />}
              <span className="flex-1">{entry.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Opens below `anchor`, flipping above it when the viewport lacks room, and stays inside the
 * viewport; closes on outside press, Esc, or a plain item.
 */
export function Menu({ anchor, entries, label, keyboard, onClose }: { anchor: HTMLElement; entries: MenuEntry[]; label: string; keyboard: boolean; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const rect = anchor.getBoundingClientRect();
  const [pos, setPos] = useState({ top: rect.bottom + 4, left: Math.max(8, rect.left - 8), ready: false });
  const close = () => {
    onClose();
    anchor.focus();
  };

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!root.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [anchor, onClose]);

  useLayoutEffect(() => {
    const panel = root.current?.firstElementChild?.getBoundingClientRect();
    if (!panel) return;
    const below = rect.bottom + 4;
    const top = below + panel.height > innerHeight - 8 ? Math.max(8, rect.top - 4 - panel.height) : below;
    setPos({ top, left: Math.min(Math.max(8, rect.left - 8), innerWidth - panel.width - 8), ready: true });
  }, []);

  return createPortal(
    <div ref={root} className={cn("fixed z-50", !pos.ready && "opacity-0")} style={{ top: pos.top, left: pos.left }}>
      <Panel entries={entries} label={label} autoFocus={keyboard} onDone={close} />
    </div>,
    document.body,
  );
}
