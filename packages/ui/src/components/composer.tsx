import { useId, useRef, useState } from "react";
import {
  Plus,
  X,
  Hand,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  Paperclip,
  Square,
  Target,
  ListTodo,
} from "lucide-react";
import {
  PERMISSION_MODES,
  type PermissionMode,
  type ThinkingLevel,
  type WireModelCatalogEntry,
  type WireCommand,
  type ContextReport,
} from "@rukie/shared";
import { PromptInput } from "./agents/prompt-input";
import { Button } from "./motion/button/base";
import { Tooltip } from "./motion/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "./motion/popover";
import * as Menu from "./ui/dropdown-menu";
import { useAppText, useComponentText } from "../lib/i18n";
import { ScrollArea } from "./ui/scroll-area";
import { formatCapacity } from "../lib/format-capacity";
import { cn } from "../lib/utils";
import { ModelPicker } from "./model-picker";
import "./goal-mode.css";

export type PromptImages = NonNullable<Extract<WireCommand, { type: "prompt" }>["images"]>;
export interface ModelSelection {
  provider: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel;
}
export interface ComposerProps {
  draft: string;
  images: PromptImages;
  onDraft: (text: string) => void;
  onImages: (images: PromptImages | ((previous: PromptImages) => PromptImages)) => void;
  disabled: boolean;
  submitting?: boolean;
  running: boolean;
  permissionMode: PermissionMode;
  onPermission: (mode: PermissionMode) => void;
  planMode: boolean;
  onPlanMode: (on: boolean) => void;
  models: WireModelCatalogEntry[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  onModel: (selection: ModelSelection) => void;
  onSend: () => void;
  onStop: () => void;
  goalEnabled?: boolean;
  goalDisabledReason?: string;
  onGoal?: () => void;
  placeholder?: string;
  contextReport?: ContextReport;
  compactionPoints?: number;
  openingContext?: number;
}
export function Composer(props: ComposerProps) {
  const t = useAppText();
  const componentText = useComponentText();
  const goalDescriptionId = useId();
  const goalMenuSelection = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const selected = props.models.find((model) => model.spec === props.model);
  const permissionIcons = { ask: Hand, "auto-review": ShieldCheck, "full-access": ShieldAlert };
  const PermissionIcon = permissionIcons[props.permissionMode];
  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const images = await Promise.all(
      Array.from(files)
        .filter((image) => image.type.startsWith("image/"))
        .map(
          (image) =>
            new Promise<PromptImages[number]>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(reader.error);
              reader.onload = () =>
                resolve({
                  data: String(reader.result).split(",")[1] ?? "",
                  mimeType: image.type,
                  name: image.name,
                });
              reader.readAsDataURL(image);
            }),
        ),
    );
    props.onImages((previous) => [...previous, ...images]);
  };
  const report = props.contextReport;
  const percent =
    report && report.window > 0
      ? Math.min(100, Math.max(0, Math.round((report.used / report.window) * 100)))
      : 0;
  const systems =
    report?.categories
      .filter((c) => ["system-prompt", "memory-files", "skills"].includes(c.name))
      .reduce((sum, c) => sum + c.tokens, 0) ?? 0;
  const tools =
    report?.categories
      .filter((c) => ["system-tools", "mcp-tools"].includes(c.name))
      .reduce((sum, c) => sum + c.tokens, 0) ?? 0;
  const messages = report?.categories.find((c) => c.name === "messages")?.tokens ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {props.images.length ? (
        <div aria-label={t("app.images")} className="flex flex-wrap gap-2">
          {props.images.map((image, index) => (
            <div
              key={`${image.name}-${index}`}
              className="flex items-center gap-1 rounded-xl border border-border bg-card p-1"
            >
              <img
                src={`data:${image.mimeType};base64,${image.data}`}
                alt={image.name ?? t("app.images")}
                className="size-10 rounded-md object-cover"
              />
              <Tooltip content={t("app.remove-image", { name: image.name ?? t("app.images") })}>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("app.remove-image", { name: image.name ?? t("app.images") })}
                  onClick={() => props.onImages(props.images.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </Tooltip>
            </div>
          ))}
        </div>
      ) : null}
      <input
        ref={file}
        aria-label={t("app.attach")}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void addImages(event.target.files);
          event.target.value = "";
        }}
      />
      <PromptInput
        className="conversation-composer conversation-pencil"
        value={props.draft}
        onValueChange={props.onDraft}
        onPaste={(event) => {
          if (
            Array.from(event.clipboardData.files).some((file) => file.type.startsWith("image/"))
          ) {
            event.preventDefault();
            void addImages(event.clipboardData.files);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (Array.from(event.dataTransfer.files).some((file) => file.type.startsWith("image/"))) {
            event.preventDefault();
            void addImages(event.dataTransfer.files);
          }
        }}
        placeholder={props.placeholder ?? t("app.prompt-placeholder")}
        aria-label={t("app.prompt")}
        disabled={props.disabled}
        submitting={props.submitting}
        hasExternalContent={Boolean(props.goalEnabled && props.images.length)}
        loading={props.running && !props.draft.trim()}
        onStop={props.onStop}
        onSubmit={props.onSend}
        leadingAction={
          <>
            <Menu.DropdownMenu>
              <Tooltip content={t("app.attach")}>
                <Menu.DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={props.disabled}
                    aria-label={t("app.attach")}
                    className="conversation-add-trigger"
                  >
                    <Plus />
                  </Button>
                </Menu.DropdownMenuTrigger>
              </Tooltip>
              <Menu.DropdownMenuContent
                side="top"
                collisionPadding={16}
                className="conversation-tools-menu conversation-pencil"
                onCloseAutoFocus={(event) => {
                  if (goalMenuSelection.current) {
                    // Radix dispatches selection before closing its FocusScope. Hand off only after unmount.
                    goalMenuSelection.current = false;
                    event.preventDefault();
                    props.onGoal?.();
                    document
                      .querySelector<HTMLTextAreaElement>(".conversation-composer textarea")
                      ?.focus();
                  } else if (props.goalEnabled) {
                    event.preventDefault();
                    document
                      .querySelector<HTMLTextAreaElement>(".conversation-composer textarea")
                      ?.focus();
                  }
                }}
              >
                <ScrollArea className="conversation-tools-scroll" viewportLabel={t("app.add")}>
                  <Menu.DropdownMenuGroup>
                    <Menu.DropdownMenuLabel>{t("app.add")}</Menu.DropdownMenuLabel>
                    <Menu.DropdownMenuItem
                      className="conversation-tool-option"
                      onSelect={() => file.current?.click()}
                    >
                      <Paperclip className="size-3" aria-hidden="true" />
                      <span>{t("app.attach")}</span>
                    </Menu.DropdownMenuItem>
                    {props.onGoal ? (
                      <Menu.DropdownMenuCheckboxItem
                        className="conversation-tool-option conversation-goal-option"
                        aria-label={t("app.goal-mode")}
                        aria-describedby={goalDescriptionId}
                        checked={props.goalEnabled}
                        disabled={Boolean(props.goalDisabledReason) || props.submitting}
                        onCheckedChange={() => {
                          goalMenuSelection.current = true;
                        }}
                      >
                        <Target className="size-3" aria-hidden="true" />
                        <span>{t("app.goal-mode")}</span>
                        <span id={goalDescriptionId} className="goal-menu-description">
                          {props.goalDisabledReason ?? t("app.goal-mode-description")}
                        </span>
                        <span aria-hidden="true" className="goal-menu-switch">
                          <span />
                        </span>
                      </Menu.DropdownMenuCheckboxItem>
                    ) : null}
                    <Menu.DropdownMenuItem
                      className="conversation-tool-option"
                      onSelect={() => props.onPlanMode(!props.planMode)}
                    >
                      <ListTodo className="size-3" aria-hidden="true" />
                      <span>{t("planMode.label")}</span>
                      <span className="ml-auto text-ui-sm text-muted-foreground">
                        {t(props.planMode ? "planMode.on" : "planMode.off")}
                      </span>
                    </Menu.DropdownMenuItem>
                  </Menu.DropdownMenuGroup>
                </ScrollArea>
              </Menu.DropdownMenuContent>
            </Menu.DropdownMenu>
            <Menu.DropdownMenu>
              <Menu.DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={props.disabled}
                  aria-label={t("app.permission")}
                  className={cn(
                    "conversation-permission-trigger min-w-0",
                    props.permissionMode === "full-access" && "conversation-full-access",
                  )}
                >
                  <PermissionIcon className="size-3 shrink-0" />
                  <span className="max-sm:sr-only">{t(`app.${props.permissionMode}`)}</span>
                  <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                </Button>
              </Menu.DropdownMenuTrigger>
              <Menu.DropdownMenuContent
                side="top"
                className="conversation-permission-menu conversation-pencil"
              >
                <Menu.DropdownMenuRadioGroup
                  value={props.permissionMode}
                  onValueChange={(value) => {
                    if (PERMISSION_MODES.some((mode) => mode === value))
                      props.onPermission(value as PermissionMode);
                  }}
                >
                  {PERMISSION_MODES.map((mode) => {
                    const Icon = permissionIcons[mode];
                    return (
                      <Menu.DropdownMenuRadioItem
                        key={mode}
                        value={mode}
                        className={cn(
                          "conversation-permission-option",
                          mode === "full-access" && "conversation-full-access",
                        )}
                      >
                        <Icon className="size-3 shrink-0" aria-hidden="true" />
                        <span className="conversation-permission-copy">
                          <span className="block font-medium">{t(`app.${mode}`)}</span>
                          <span className="block text-ui-sm text-muted-foreground">
                            {t(`app.${mode}-description`)}
                          </span>
                        </span>
                      </Menu.DropdownMenuRadioItem>
                    );
                  })}
                </Menu.DropdownMenuRadioGroup>
              </Menu.DropdownMenuContent>
            </Menu.DropdownMenu>
            {props.goalEnabled ? (
              <Button
                variant="ghost"
                size="sm"
                className="conversation-goal-chip text-ui-base"
                aria-label={t("app.goal-close")}
                onClick={() => {
                  props.onGoal?.();
                  document
                    .querySelector<HTMLTextAreaElement>(".conversation-composer textarea")
                    ?.focus();
                }}
              >
                <span className="conversation-goal-chip-icon">
                  <Target className="goal-target-icon" aria-hidden="true" />
                  <X className="goal-close-icon" aria-hidden="true" />
                </span>
                <span>{t("app.goal-label")}</span>
              </Button>
            ) : null}
            {props.planMode && (
              <Button
                variant="ghost"
                size="sm"
                disabled={props.disabled}
                className="conversation-plan-mode"
                aria-label={t("planMode.close")}
                onClick={() => props.onPlanMode(false)}
              >
                <span className="conversation-plan-icon" aria-hidden="true">
                  <ListTodo className="conversation-plan-rest" />
                  <X className="conversation-plan-close" />
                </span>
                <span>{t("planMode.label")}</span>
              </Button>
            )}
          </>
        }
        trailingAction={
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {props.running && Boolean(props.draft.trim()) && (
              <Tooltip content={componentText("component.stop-generating")}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={componentText("component.stop-generating")}
                  disabled={props.disabled}
                  onClick={props.onStop}
                >
                  <Square />
                </Button>
              </Tooltip>
            )}
            <Popover side="top" align="end" open={contextOpen} onOpenChange={setContextOpen}>
              <Tooltip content={t("app.context")}>
                <PopoverTrigger>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t("app.context")} ${percent}%`}
                  >
                    <svg
                      className="conversation-context-ring -rotate-90"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        fill="none"
                        stroke="currentColor"
                        className="conversation-ring-track"
                        strokeWidth="3"
                      />
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        fill="none"
                        stroke="currentColor"
                        className="conversation-ring-value"
                        strokeWidth="3"
                        pathLength="100"
                        strokeDasharray={`${percent} 100`}
                      />
                    </svg>
                  </Button>
                </PopoverTrigger>
              </Tooltip>
              <PopoverContent
                ariaLabel={t("app.context")}
                className="conversation-context-panel conversation-pencil"
              >
                <ScrollArea
                  className="conversation-context-scroll"
                  viewportLabel={t("app.context")}
                >
                  <div className="conversation-context-content">
                    <h2>{t("app.context")}</h2>
                    {report ? (
                      <>
                        <p className="conversation-context-model">
                          {selected?.name || props.model} · {formatCapacity(report.window)}{" "}
                          {t("app.model-context")}
                        </p>
                        <div className="conversation-context-usage">
                          <strong>{t("app.context-used", { percent })}</strong>
                          <span>
                            {formatCapacity(report.used)} / {formatCapacity(report.window)} ·{" "}
                            {t("app.context-share")}
                          </span>
                        </div>
                        <div
                          data-context-bar
                          className="conversation-context-bar"
                          aria-hidden="true"
                        >
                          {[systems, messages, tools].map((tokens, index) => (
                            <span
                              key={index}
                              data-context-category={index}
                              style={{
                                width: `${report.window > 0 ? Math.min(100, (tokens / report.window) * 100) : 0}%`,
                              }}
                            />
                          ))}
                        </div>
                        <dl className="conversation-context-categories">
                          {(
                            [
                              ["system", systems, "context-system-description"],
                              ["messages", messages, "context-messages-description"],
                              ["tools", tools, "context-tools-description"],
                            ] satisfies [
                              "system" | "messages" | "tools",
                              number,
                              (
                                | "context-system-description"
                                | "context-messages-description"
                                | "context-tools-description"
                              ),
                            ][]
                          ).map(([name, value, description], index) => (
                            <div
                              key={name}
                              className="conversation-context-category"
                              data-context-category={index}
                            >
                              <dt>
                                <span data-context-legend />
                                {t(`app.${name}`)}
                              </dt>
                              <dd>
                                {formatCapacity(Number(value))} ·{" "}
                                {report.used > 0
                                  ? ((Number(value) / report.used) * 100).toFixed(2)
                                  : "0.00"}
                                %
                              </dd>
                              <p>{t(`app.${description}`)}</p>
                            </div>
                          ))}
                        </dl>
                        <dl className="conversation-context-footer">
                          <dt>{t("app.opening")}</dt>
                          <dd>{formatCapacity(props.openingContext ?? systems + tools)}</dd>
                          <dt>{t("app.compactions")}</dt>
                          <dd>{props.compactionPoints ?? 0}</dd>
                        </dl>
                      </>
                    ) : (
                      <p className="text-ui-sm text-muted-foreground">{t("app.no-context")}</p>
                    )}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <ModelPicker
              models={props.models}
              model={props.model}
              thinkingLevel={props.thinkingLevel}
              disabled={props.disabled}
              onModel={props.onModel}
            />
          </div>
        }
      />
    </div>
  );
}
