import { useComponentText } from "@/lib/i18n";
// beui.dev/components/agents/prompt-input

import { ArrowUp, Plus, Square } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Tooltip } from "@/components/motion/tooltip";
import { Button } from "@/components/motion/button";
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "@/components/motion/popover-morph";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/motion/select";

import { cn } from "@/lib/utils";
import { PromptEditor } from "./prompt-editor";
import type { ComposerInsertionAction } from "./skill-picker";
import type { WireSkill } from "@rukie/shared";

export interface PromptModel {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PromptAction {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PromptInputProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "value" | "defaultValue" | "onChange" | "onSubmit" | "children"
> {
  disabled?: boolean;
  skills?: readonly WireSkill[];
  insertionActions?: readonly ComposerInsertionAction[];
  insertionLabel?: string;
  onSkillsOpen?: () => void;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  models?: PromptModel[];
  model?: string;
  defaultModel?: string;
  onModelChange?: (model: string) => void;
  actions?: PromptAction[];
  onAction?: (action: string) => void;
  onSubmit?: (value: string, model?: string) => void | Promise<void>;
  loading?: boolean;
  submitting?: boolean;
  /** Explicit opt-in when the controlled owner has content outside the editor. */
  hasExternalContent?: boolean;
  onStop?: () => void;
  minRows?: number;
  maxRows?: number;
  leadingAction?: ReactNode;
  trailingAction?: ReactNode;
  className?: string;
}

export function PromptInput({
  value,
  defaultValue = "",
  onValueChange,
  models = [],
  model,
  defaultModel,
  onModelChange,
  actions = [],
  onAction,
  onSubmit,
  loading = false,
  submitting = false,
  hasExternalContent = false,
  onStop,
  minRows = 2,
  maxRows = 8,
  leadingAction,
  trailingAction,
  className,
  disabled,
  skills,
  insertionActions,
  insertionLabel,
  onSkillsOpen,
  placeholder: placeholderProp,
  "aria-label": ariaLabelProp,
  onKeyDown,
  ...editorProps
}: PromptInputProps) {
  const componentText = useComponentText();
  const placeholder = placeholderProp ?? componentText("component.ask-the-agent-to-do-something");
  const ariaLabel = ariaLabelProp ?? componentText("component.prompt");

  const reduce = useReducedMotion() ?? false;
  const formRef = useRef<HTMLFormElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [internalModel, setInternalModel] = useState(defaultModel ?? models[0]?.value);
  const [actionsOpen, setActionsOpen] = useState(false);
  const currentValue = value ?? internalValue;
  const currentModelValue = model ?? internalModel;
  const currentModel = models.find((option) => option.value === currentModelValue);
  const canSubmit =
    (Boolean(currentValue.trim()) || hasExternalContent) && !disabled && !loading && !submitting;

  const resizeEditor = useCallback(() => {
    const editor = editorRef.current;
    const measurement = measurementRef.current;
    if (!editor || !measurement) return;

    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight);
    const nextHeight = Math.min(
      Math.max(measurement.scrollHeight, minRows * lineHeight),
      maxRows * lineHeight,
    );
    const height = `${nextHeight}px`;
    if (editor.style.height !== height) editor.style.height = height;
  }, [currentValue, maxRows, minRows]);

  useLayoutEffect(() => {
    resizeEditor();
  }, [resizeEditor]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || typeof ResizeObserver === "undefined") return;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        resizeEditor();
      });
    });
    observer.observe(editor);
    if (measurementRef.current) observer.observe(measurementRef.current);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [resizeEditor]);

  const setValue = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  const setModel = (next: string) => {
    if (model === undefined) setInternalModel(next);
    onModelChange?.(next);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = currentValue.trim();
    if ((!prompt && !hasExternalContent) || disabled || loading || submitting) return;

    onSubmit?.(prompt, currentModelValue);
    if (value === undefined) setInternalValue("");
    editorRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.key === "Enter" && event.nativeEvent.isComposing) {
      // Leave IME confirmation to the browser without inserting an editor line break.
      event.stopPropagation();
      return;
    }
    if (event.defaultPrevented) {
      event.stopPropagation();
      return;
    }
    if (
      event.currentTarget.getAttribute("aria-expanded") === "true" &&
      !event.nativeEvent.isComposing &&
      ["Enter", "Tab", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)
    )
      return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    submit();
  };

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className={cn(
        "relative w-full rounded-2xl border border-border/80 bg-background p-2 shadow-(--shadow-composer) focus-within:border-foreground/25",
        className,
      )}
    >
      <div
        ref={measurementRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute inset-x-2 top-0 whitespace-pre-wrap px-2 text-ui-base [overflow-wrap:break-word]"
      >
        {`${currentValue}\u200b`}
      </div>
      <PromptEditor
        editorRef={editorRef}
        anchorRef={formRef}
        insertionActions={insertionActions}
        insertionOpen={actionsOpen}
        onInsertionOpenChange={setActionsOpen}
        skills={skills}
        onSkillsOpen={onSkillsOpen}
        value={currentValue}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        {...editorProps}
        onValueChange={setValue}
        onKeyDownCapture={handleKeyDown}
        className="prompt-editor before:pointer-events-none before:absolute before:text-muted-foreground data-[empty]:before:content-[attr(data-placeholder)] scrollbar-hide relative block w-full overflow-y-auto whitespace-pre-wrap bg-transparent px-2 pt-1 text-ui-base text-foreground outline-none [overflow-wrap:break-word] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      />

      <div className="mt-1 flex min-h-8 flex-wrap items-center gap-1">
        {actions.length ? (
          <MorphPopover open={actionsOpen} onOpenChange={setActionsOpen}>
            <MorphPopoverTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || loading}
                aria-label={componentText("component.add-to-prompt")}
                className={cn(!trailingAction && "ml-auto")}
              >
                <span
                  aria-hidden="true"
                  style={{ transform: actionsOpen ? "rotate(45deg)" : undefined }}
                >
                  <Plus />
                </span>
              </Button>
            </MorphPopoverTrigger>

            <MorphPopoverContent
              side="top"
              align="start"
              sideOffset={4}
              radius={8}
              className="w-56 space-y-0.5 bg-menu p-1"
            >
              {actions.map((action) => (
                <Button
                  size="compact"
                  variant="ghost"
                  key={action.value}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    onAction?.(action.value);
                    setActionsOpen(false);
                  }}
                  className="flex text-ui-base justify-start w-full items-start gap-2 rounded-md px-2 py-1 min-h-8 text-left outline-none not-disabled:hover:bg-menu-hover focus-visible:bg-menu-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {action.icon ? (
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3">
                      {action.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <span className="block text-ui-base text-foreground">{action.label}</span>
                    {action.description ? (
                      <span className="mt-0.5 block text-ui-sm leading-4 text-muted-foreground">
                        {action.description}
                      </span>
                    ) : null}
                  </span>
                </Button>
              ))}
            </MorphPopoverContent>
          </MorphPopover>
        ) : null}
        {insertionActions?.length ? (
          <Tooltip content={insertionLabel ?? componentText("component.add-to-prompt")}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={insertionLabel ?? componentText("component.add-to-prompt")}
              aria-haspopup="listbox"
              aria-expanded={actionsOpen}
              className="conversation-add-trigger"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                editorRef.current?.focus({ preventScroll: true });
                setActionsOpen(!actionsOpen);
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
          </Tooltip>
        ) : null}
        {leadingAction}
        {models.length ? (
          <Select
            value={currentModelValue}
            onValueChange={setModel}
            disabled={disabled || loading}
            className="min-w-0"
          >
            <SelectTrigger
              size="composer"
              className="min-h-8 w-auto max-w-52 rounded-lg border-0 bg-transparent px-2 py-0 text-ui-sm hover:bg-muted focus-visible:ring-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                {currentModel?.icon ? (
                  <span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3">
                    {currentModel.icon}
                  </span>
                ) : null}
                <span className="truncate text-muted-foreground">
                  {currentModel?.label ?? componentText("component.choose-model")}
                </span>
              </span>
            </SelectTrigger>
            <SelectContent className="right-auto w-52">
              {models.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="py-1"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.icon ? (
                      <span className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3">
                        {option.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate text-ui-base text-foreground">
                      {option.label}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {trailingAction}
        <Tooltip
          content={componentText(loading ? "component.stop-generating" : "component.send-prompt")}
        >
          <Button
            type={loading ? "button" : "submit"}
            size="icon"
            disabled={loading ? !onStop : !canSubmit}
            aria-label={
              loading
                ? componentText("component.stop-generating")
                : componentText("component.send-prompt")
            }
            onClick={loading ? onStop : undefined}
            className={cn(!trailingAction && "ml-auto")}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={loading ? "stop" : "send"}
                initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.8 }}
                transition={{ duration: reduce ? 0 : 0.12 }}
                className="grid place-items-center"
              >
                {loading ? <Square className="fill-current" /> : <ArrowUp />}
              </motion.span>
            </AnimatePresence>
          </Button>
        </Tooltip>
      </div>
    </form>
  );
}
