import { useRef } from "react";
import {
  Plus,
  X,
  Hand,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  CircleGauge,
  Square,
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
import { cn } from "../lib/utils";
import { ModelPicker } from "./model-picker";

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
  models: WireModelCatalogEntry[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  onModel: (selection: ModelSelection) => void;
  onSend: () => void;
  onStop: () => void;
  contextReport?: ContextReport;
  compactionPoints?: number;
  openingContext?: number;
}
export function Composer(props: ComposerProps) {
  const t = useAppText();
  const componentText = useComponentText();
  const file = useRef<HTMLInputElement>(null);
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
                  <X className="size-3" />
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
        aria-label={t("app.prompt")}
        disabled={props.disabled}
        submitting={props.submitting}
        loading={props.running && !props.draft.trim()}
        onStop={props.onStop}
        onSubmit={props.onSend}
        leadingAction={
          <>
            <Tooltip content={t("app.attach")}>
              <Button
                variant="ghost"
                size="icon"
                disabled={props.disabled}
                aria-label={t("app.attach")}
                onClick={() => file.current?.click()}
              >
                <Plus className="size-4" />
              </Button>
            </Tooltip>
            <Menu.DropdownMenu>
              <Menu.DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={props.disabled}
                  aria-label={t("app.permission")}
                  className={cn(
                    "min-w-0",
                    props.permissionMode === "full-access" && "text-warning",
                  )}
                >
                  <PermissionIcon className="size-4 shrink-0" />
                  <span className="max-sm:sr-only">{t(`app.${props.permissionMode}`)}</span>
                  <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
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
                          mode === "full-access" && "text-warning",
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span>
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
                  <Square className="size-4" />
                </Button>
              </Tooltip>
            )}
            <Popover side="top" align="end">
              <Tooltip content={t("app.context")}>
                <PopoverTrigger>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t("app.context")} ${percent}%`}
                  >
                    <svg className="size-5 -rotate-90" viewBox="0 0 24 24" aria-hidden="true">
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        fill="none"
                        stroke="currentColor"
                        className="text-border"
                        strokeWidth="3"
                      />
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        fill="none"
                        stroke="currentColor"
                        className="text-accent"
                        strokeWidth="3"
                        pathLength="100"
                        strokeDasharray={`${percent} 100`}
                      />
                    </svg>
                  </Button>
                </PopoverTrigger>
              </Tooltip>
              <PopoverContent
                aria-label={t("app.context")}
                className="conversation-context-panel conversation-pencil"
              >
                <h2 className="mb-3 flex items-center gap-2 text-ui-base font-medium">
                  <CircleGauge className="size-4" />
                  {t("app.context")}
                </h2>
                {report ? (
                  <>
                    <p className="mb-4 text-ui-sm text-muted-foreground">
                      {selected?.name || props.model} · {report.window.toLocaleString()}{" "}
                      {t("app.model-context")}
                    </p>
                    <p className="mb-4 flex justify-between text-ui-sm">
                      {report.used.toLocaleString()} / {report.window.toLocaleString()} ({percent}%)
                    </p>
                    <div
                      className="mb-3 flex h-1.5 overflow-hidden rounded-full bg-muted"
                      aria-hidden="true"
                    >
                      <span
                        className="bg-primary"
                        style={{ width: `${(systems / report.window) * 100}%` }}
                      />
                      <span
                        className="bg-violet"
                        style={{ width: `${(tools / report.window) * 100}%` }}
                      />
                      <span
                        className="bg-neon"
                        style={{ width: `${(messages / report.window) * 100}%` }}
                      />
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-ui-sm">
                      {[
                        [t("app.system"), systems],
                        [t("app.tools"), tools],
                        [t("app.messages"), messages],
                        [t("app.opening"), props.openingContext ?? systems + tools],
                        [t("app.compactions"), props.compactionPoints ?? 0],
                      ].map(([name, value]) => (
                        <div key={name} className="contents">
                          <dt className="text-muted-foreground">{name}</dt>
                          <dd className="text-right font-mono">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <p className="text-ui-sm text-muted-foreground">{t("app.no-context")}</p>
                )}
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
