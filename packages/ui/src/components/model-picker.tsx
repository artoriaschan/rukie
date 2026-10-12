import { useLayoutEffect, useRef, useState } from "react";
import { autoUpdate, computePosition, flip, offset, shift, size } from "@floating-ui/dom";
import { ChevronDown, Check } from "lucide-react";
import { THINKING_LEVELS, type ThinkingLevel, type WireModelCatalogEntry } from "@rukie/shared";
import type { ModelSelection } from "./composer";
import { Button } from "./motion/button/base";
import * as Menu from "./ui/dropdown-menu";
import { ScrollArea } from "./ui/scroll-area";
import { ProviderIcon } from "./provider-icon";
import { useAppText } from "../lib/i18n";
import "./conversation-controls.css";
import { formatCapacity } from "../lib/format-capacity";
import { reasoningLabels } from "../lib/reasoning-labels";

export function ModelPicker({
  models,
  model,
  thinkingLevel,
  disabled,
  onModel,
}: {
  models: WireModelCatalogEntry[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  disabled: boolean;
  onModel: (selection: ModelSelection) => void;
}) {
  const t = useAppText();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string>();
  const content = useRef<HTMLDivElement>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const [detailElement, setDetailElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open || !preview || !listElement || !detailElement) return;
    let revision = 0;
    let stopped = false;
    const update = () => {
      const current = ++revision;
      const narrow = window.matchMedia("(max-width: 671px)").matches;
      void computePosition(listElement, detailElement, {
        placement: narrow ? "top-start" : "right-start",
        middleware: [
          offset(4),
          flip({ padding: 16, fallbackPlacements: narrow ? ["bottom-start"] : ["left-start"] }),
          shift({ padding: 16, crossAxis: true }),
          size({
            padding: 16,
            apply({ availableHeight, elements }) {
              if (stopped || revision !== current) return;
              elements.floating.style.setProperty(
                "--model-detail-height",
                `${Math.max(0, Math.min(184, availableHeight))}px`,
              );
            },
          }),
        ],
      }).then(({ x, y }) => {
        if (stopped || revision !== current) return;
        Object.assign(detailElement.style, { left: `${x}px`, top: `${y}px` });
        detailElement.dataset.positioned = "true";
      });
    };
    detailElement.dataset.positioned = "false";
    const stop = autoUpdate(listElement, detailElement, update);
    return () => {
      stopped = true;
      stop();
    };
  }, [open, preview, listElement, detailElement]);
  const available = models.filter((entry) => entry.authenticated);
  const selected = available.find((entry) => entry.spec === model);
  const detail = available.find((entry) => entry.spec === preview) ?? selected ?? available[0];
  const choose = (entry: WireModelCatalogEntry, level?: ThinkingLevel) => {
    onModel({ provider: entry.providerId, modelId: entry.id, thinkingLevel: level });
    setOpen(false);
  };
  return (
    <Menu.DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setPreview(undefined);
        setOpen(next);
      }}
    >
      <Menu.DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={t("app.model")}
          className="conversation-model-trigger"
          title={`${selected?.name || model || t("app.model")}${thinkingLevel ? ` · ${reasoningLabels[thinkingLevel]}` : ""}`}
        >
          <span className="truncate">{selected?.name || model || t("app.model")}</span>
          {thinkingLevel ? (
            <span className="conversation-model-level shrink-0">
              · {reasoningLabels[thinkingLevel]}
            </span>
          ) : null}
          <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
        </Button>
      </Menu.DropdownMenuTrigger>
      <Menu.DropdownMenuContent
        ref={content}
        side="top"
        align="end"
        sideOffset={4}
        collisionPadding={16}
        className="conversation-model-menu conversation-pencil space-y-0"
        aria-label={t("app.model")}
      >
        <div
          ref={setListElement}
          data-model-list
          className="conversation-model-list conversation-control-panel"
        >
          <ScrollArea className="conversation-model-scroll" viewportLabel={t("app.model")}>
            <Menu.DropdownMenuGroup>
              {available.length ? (
                available.map((entry) => (
                  <Menu.DropdownMenuItem
                    key={entry.spec}
                    textValue={entry.name || entry.id}
                    data-model-spec={entry.spec}
                    data-selected={entry.spec === model}
                    aria-current={entry.spec === model ? "true" : undefined}
                    className="conversation-model-option"
                    onFocus={() => setPreview(entry.spec)}
                    onPointerMove={() => setPreview(entry.spec)}
                    onSelect={() => choose(entry)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowRight" && entry.thinkingLevels.length) {
                        event.preventDefault();
                        content.current
                          ?.querySelector<HTMLButtonElement>("[data-model-reasoning] button")
                          ?.focus();
                      }
                    }}
                  >
                    <ProviderIcon providerId={entry.providerId} providerName={entry.providerName} />
                    <span className="truncate" title={entry.name || entry.id}>
                      {entry.name || entry.id}
                    </span>
                    <span
                      className="conversation-model-provider truncate"
                      title={entry.providerName}
                    >
                      {entry.providerName}
                    </span>
                    <span className="size-4">
                      {entry.spec === model ? (
                        <Check data-model-check aria-hidden="true" className="size-4" />
                      ) : null}
                    </span>
                  </Menu.DropdownMenuItem>
                ))
              ) : (
                <Menu.DropdownMenuLabel>{t("app.no-models")}</Menu.DropdownMenuLabel>
              )}
            </Menu.DropdownMenuGroup>
          </ScrollArea>
        </div>
        {detail ? (
          <section
            ref={setDetailElement}
            aria-label={detail.name || detail.id}
            aria-hidden={preview === undefined}
            inert={preview === undefined}
            data-preview={preview !== undefined}
            className="conversation-model-detail conversation-control-panel"
          >
            <ScrollArea
              className="conversation-model-detail-scroll"
              viewportLabel={detail.name || detail.id}
            >
              <h3 className="conversation-model-heading" title={detail.name || detail.id}>
                {detail.name || detail.id}
              </h3>
              <dl className="conversation-model-facts">
                <dt>{t("app.model-input")}</dt>
                <dd>{detail.input.map((input) => t(`app.model-input-${input}`)).join(" / ")}</dd>
                <dt>{t("app.model-context")}</dt>
                <dd title={detail.contextWindow.toLocaleString()}>
                  {formatCapacity(detail.contextWindow)}
                </dd>
              </dl>
              {detail.thinkingLevels.length ? (
                <div data-model-reasoning className="conversation-model-reasoning">
                  <p>{t("app.model-reasoning")}</p>
                  <div className="flex flex-wrap gap-2">
                    {THINKING_LEVELS.filter((level) => detail.thinkingLevels.includes(level)).map(
                      (level) => (
                        <Button
                          key={level}
                          size="sm"
                          variant="outline"
                          aria-pressed={model === detail.spec && thinkingLevel === level}
                          className="conversation-reasoning-chip"
                          onClick={() => choose(detail, level)}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowLeft") {
                              event.preventDefault();
                              const option = Array.from(
                                content.current?.querySelectorAll<HTMLElement>(
                                  "[data-model-spec]",
                                ) ?? [],
                              ).find((item) => item.dataset.modelSpec === detail.spec);
                              option?.focus();
                            } else if (
                              ["ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(
                                event.key,
                              )
                            ) {
                              event.preventDefault();
                              const buttons = Array.from(
                                content.current?.querySelectorAll<HTMLButtonElement>(
                                  "[data-model-reasoning] button",
                                ) ?? [],
                              );
                              const index = buttons.indexOf(event.currentTarget);
                              const next =
                                event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? buttons.length - 1
                                    : (index +
                                        (event.key === "ArrowUp" ? -1 : 1) +
                                        buttons.length) %
                                      buttons.length;
                              buttons[next]?.focus();
                            }
                          }}
                        >
                          {reasoningLabels[level]}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              ) : null}
            </ScrollArea>
          </section>
        ) : null}
      </Menu.DropdownMenuContent>
    </Menu.DropdownMenu>
  );
}
