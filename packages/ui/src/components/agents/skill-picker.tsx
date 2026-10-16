import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_DOWN_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from "lexical";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import type { WireSkill } from "@rukie/shared";
import { Sparkles } from "lucide-react";
import { Popover, PopoverContent } from "../motion/popover";
import { ScrollArea } from "../ui/scroll-area";
import { useAppText } from "@/lib/i18n";
import { $createSkillToken, $serializePrompt } from "./skill-token";
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

export interface SkillPickerProps {
  insertionOpen?: boolean;
  onInsertionOpenChange?: (open: boolean) => void;
  insertionActions?: readonly ComposerInsertionAction[];
  skills?: readonly WireSkill[];
  onSkillsOpen?: () => void;
  disabled?: boolean;
  anchorRef: RefObject<HTMLElement | null>;
}

export function SkillPicker({ skills = [], onSkillsOpen, anchorRef, disabled }: SkillPickerProps) {
  const [editor] = useLexicalComposerContext();
  const t = useAppText();
  const id = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const lastOpen = useRef(false);
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
  }, [anchorRef, query]);
  const matches =
    query === null
      ? []
      : skills
          .filter((skill) => skill.name.toLowerCase().includes(query.toLowerCase()))
          .sort(
            (a, b) =>
              Number(!a.name.toLowerCase().startsWith(query.toLowerCase())) -
                Number(!b.name.toLowerCase().startsWith(query.toLowerCase())) ||
              a.name.localeCompare(b.name),
          );
  const open = !disabled && query !== null && query !== dismissed && matches.length > 0;
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          const text = $serializePrompt();
          let next: string | null = null;
          if ($isRangeSelection(selection) && selection.isCollapsed() && /^\/\S*$/.test(text)) {
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
    [editor],
  );
  useEffect(() => {
    const eligible = !disabled && query !== null && query !== dismissed;
    if (eligible && !lastOpen.current) onSkillsOpen?.();
    lastOpen.current = eligible;
  }, [query, dismissed, onSkillsOpen, disabled]);
  const choose = (skill: WireSkill) => {
    editor.update(() => {
      const space = $createTextNode(" ");
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createSkillToken(skill), space));
      space.selectEnd();
    });
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
            setDismissed(query);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, open, matches, activeIndex, query],
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
        if (!value) setDismissed(query);
      }}
    >
      <PopoverContent ref={panel} className="composer-insertion-panel" ariaLabel={t("app.skills")}>
        <ScrollArea
          style={{ height: Math.min(matches.length, 10) * 32 + 24 }}
          className="composer-insertion-scroll"
          viewportLabel={t("app.skills")}
        >
          <div role="listbox" id={id} aria-label={t("app.skills")}>
            {matches.length > 0 && (
              <div role="group" aria-labelledby={`${id}-heading`}>
                <div id={`${id}-heading`} className="composer-insertion-heading">
                  {t("app.skills")}
                </div>
                {matches.map((skill, index) => (
                  <div
                    key={skill.name}
                    id={`${id}-${index}`}
                    role="option"
                    aria-label={`${skill.name} ${skill.description} ${t(skill.scope === "project" ? "app.skill-project" : "app.skill-user")}`}
                    aria-selected={index === activeIndex}
                    className="composer-insertion-option"
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => setActive(index)}
                    onClick={() => choose(skill)}
                  >
                    <Sparkles aria-hidden="true" />
                    <span className="composer-insertion-name">{skill.name}</span>
                    <span className="composer-insertion-description" title={skill.description}>
                      {skill.description}
                    </span>
                    <span className="composer-insertion-scope">
                      {t(skill.scope === "project" ? "app.skill-project" : "app.skill-user")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
