import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  $isTextNode,
  KEY_DOWN_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from "lexical";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { WireSkill } from "@rukie/shared";
import { Sparkles } from "lucide-react";
import { Popover, PopoverContent } from "../motion/popover";
import { ScrollArea } from "../ui/scroll-area";
import { useAppText } from "@/lib/i18n";
import { $createSkillToken, $serializePrompt, SkillTokenNode } from "./skill-token";
import "./skill-picker.css";

export interface ComposerInsertionAction {
  name: string;
  label: string;
  description?: string;
  group: "add" | "command";
  icon?: ReactNode;
  disabled?: boolean;
  stateLabel?: string;
  checked?: boolean;
  trailing?: ReactNode;
  onSelect: () => void;
}

type InsertionItem =
  | { skill: WireSkill; name: string }
  | { action: ComposerInsertionAction; name: string };

export interface SkillPickerProps {
  insertionOpen?: boolean;
  onInsertionOpenChange?: (open: boolean) => void;
  insertionActions?: readonly ComposerInsertionAction[];
  skills?: readonly WireSkill[];
  onSkillsOpen?: () => void;
  disabled?: boolean;
  anchorRef: RefObject<HTMLElement | null>;
}

export function SkillPicker({
  skills = [],
  onSkillsOpen,
  anchorRef,
  disabled,
  insertionOpen = false,
  onInsertionOpenChange,
  insertionActions = [],
}: SkillPickerProps) {
  const [editor] = useLexicalComposerContext();
  const t = useAppText();
  const id = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const lastOpen = useRef<"plus" | "slash" | null>(null);
  const previousText = useRef<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const update = () => {
      const box = anchor.getBoundingClientRect();
      panel.current?.style.setProperty("--composer-insertion-width", `${box.width}px`);
      panel.current?.style.setProperty(
        "--composer-insertion-height",
        `${Math.max(0, box.top - 22)}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchorRef, query, insertionOpen]);
  const filter = (name: string) =>
    insertionOpen || (query !== null && name.toLowerCase().includes(query.toLowerCase()));
  const sortQuery = insertionOpen ? "" : (query?.toLowerCase() ?? "");
  const sort = (a: { name: string }, b: { name: string }) =>
    Number(!a.name.replace(/^\//, "").toLowerCase().startsWith(sortQuery)) -
      Number(!b.name.replace(/^\//, "").toLowerCase().startsWith(sortQuery)) ||
    a.name.localeCompare(b.name);
  const groups: { name: string; items: InsertionItem[] }[] = [
    {
      name: t("app.add"),
      items: insertionOpen
        ? insertionActions
            .filter((action) => action.group === "add")
            .map((action) => ({ action, name: action.name }))
        : [],
    },
    {
      name: t("app.builtin-commands"),
      items: insertionActions
        .filter((action) => action.group === "command" && filter(action.name.replace(/^\//, "")))
        .map((action) => ({ action, name: action.name }))
        .sort(sort),
    },
    {
      name: t("app.skills"),
      items: skills
        .filter((skill) => filter(skill.name))
        .map((skill) => ({ skill, name: skill.name }))
        .sort(sort),
    },
  ].filter((group) => group.items.length > 0);
  const matches = groups.flatMap((group) => group.items);
  const open =
    !disabled && (insertionOpen || (query !== null && query !== dismissed)) && matches.length > 0;
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  useEffect(() => {
    if (insertionOpen) {
      setActive(0);
      editor.focus();
    }
  }, [editor, insertionOpen]);
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          const text = $serializePrompt();
          if (insertionOpen && previousText.current !== null && previousText.current !== text)
            onInsertionOpenChange?.(false);
          previousText.current = text;
          let next: string | null = null;
          const first = $getRoot().getFirstChild();
          const hasSkill = $isElementNode(first) && first.getFirstChild() instanceof SkillTokenNode;
          if (
            !hasSkill &&
            $isRangeSelection(selection) &&
            selection.isCollapsed() &&
            /^\/\S*$/.test(text)
          ) {
            const before = selection.anchor
              .getNode()
              .getTextContent()
              .slice(0, selection.anchor.offset);
            if (!before.includes("\n")) next = text.slice(1);
          }
          setQuery((previous) => {
            if (previous !== next) {
              setActive(0);
              setDismissed(null);
            }
            return next;
          });
        });
      }),
    [editor, insertionOpen, onInsertionOpenChange],
  );
  useEffect(() => {
    const entry = disabled
      ? null
      : insertionOpen
        ? "plus"
        : query !== null && query !== dismissed
          ? "slash"
          : null;
    if (entry && entry !== lastOpen.current) onSkillsOpen?.();
    lastOpen.current = entry;
  }, [query, dismissed, onSkillsOpen, disabled, insertionOpen]);
  const close = () => {
    setDismissed(query);
    onInsertionOpenChange?.(false);
  };
  const choose = (item: InsertionItem) => {
    if ("action" in item) {
      if (item.action.disabled) return;
      close();
      editor.focus();
      item.action.onSelect();
      return;
    }
    editor.update(() => {
      const token = $createSkillToken(item.skill);
      const root = $getRoot();
      if (insertionOpen) {
        const first = root.getFirstChild();
        const paragraph = $isElementNode(first) ? first : $createParagraphNode();
        if (!paragraph.isAttached()) root.append(paragraph);
        const beginning = paragraph.getFirstChild();
        if (beginning instanceof SkillTokenNode) {
          beginning.replace(token);
          const next = token.getNextSibling();
          if ($isTextNode(next) && next.getTextContent().startsWith(" ")) next.select(1, 1);
          else {
            const space = $createTextNode(" ");
            token.insertAfter(space);
            space.selectEnd();
          }
        } else {
          const space = $createTextNode(" ");
          if (beginning) {
            beginning.insertBefore(token);
            token.insertAfter(space);
          } else paragraph.append(token, space);
          space.selectEnd();
        }
      } else {
        const space = $createTextNode(" ");
        root.clear().append($createParagraphNode().append(token, space));
        space.selectEnd();
      }
    });
    close();
    setQuery(null);
    editor.focus();
  };
  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (!open || event.isComposing) return false;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive(
              (previous) =>
                (previous + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length,
            );
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            choose(matches[activeIndex]!);
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            close();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, open, matches, activeIndex, query, insertionOpen, onInsertionOpenChange],
  );
  useEffect(() => {
    const input = editor.getRootElement();
    if (!input) return;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", String(open));
    if (open) {
      input.setAttribute("aria-controls", id);
      input.setAttribute("aria-activedescendant", `${id}-${activeIndex}`);
    } else {
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-activedescendant");
    }
    if (open) document.getElementById(`${id}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [editor, open, id, activeIndex]);
  return (
    <Popover
      className="absolute size-0"
      trigger="manual"
      side="top"
      allowFlip={false}
      align="start"
      anchorRef={anchorRef}
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <PopoverContent
        ref={panel}
        className="composer-insertion-panel"
        ariaLabel={t("app.insertion")}
      >
        <ScrollArea
          style={{ height: Math.min(matches.length, 10) * 32 + groups.length * 24 }}
          className="composer-insertion-scroll"
          viewportLabel={t("app.insertion")}
        >
          <div role="listbox" id={id} aria-label={t("app.insertion")}>
            {groups.map((group, groupIndex) => (
              <div key={group.name} role="group" aria-labelledby={`${id}-heading-${groupIndex}`}>
                <div id={`${id}-heading-${groupIndex}`} className="composer-insertion-heading">
                  {group.name}
                </div>
                {group.items.map((item) => {
                  const index = matches.indexOf(item);
                  const skill = "skill" in item ? item.skill : undefined;
                  const action = "action" in item ? item.action : undefined;
                  const description = skill?.description ?? action?.description;
                  const scope = skill
                    ? t(skill.scope === "project" ? "app.skill-project" : "app.skill-user")
                    : action?.stateLabel;
                  return (
                    <div
                      key={item.name}
                      id={`${id}-${index}`}
                      role="option"
                      aria-label={
                        skill
                          ? `${skill.name} ${skill.description} ${scope}`
                          : `${action?.name}${action?.name !== action?.label ? ` ${action?.label}` : ""}${scope ? ` ${scope}` : ""}`
                      }
                      aria-describedby={description ? `${id}-${index}-description` : undefined}
                      title={description}
                      aria-disabled={action?.disabled || undefined}
                      aria-selected={index === activeIndex}
                      data-checked={action?.checked}
                      className="composer-insertion-option"
                      onPointerDown={(event) => event.preventDefault()}
                      onPointerMove={() => setActive(index)}
                      onClick={() => choose(item)}
                    >
                      {skill ? <Sparkles aria-hidden="true" /> : action?.icon}
                      <span className="composer-insertion-name">{item.name}</span>
                      <span
                        id={`${id}-${index}-description`}
                        className="composer-insertion-description"
                        title={description}
                      >
                        {description}
                      </span>
                      <span className="composer-insertion-scope">{action?.trailing ?? scope}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
