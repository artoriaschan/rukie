import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleCheck, CircleX } from "lucide-react";
import type { PromptGroup, TranscriptState, PermissionDecision } from "../lib/transcript";
import { messageText, presentationCallId } from "../lib/transcript";
import { useAppText } from "../lib/i18n";
import { Button } from "./motion/button/base";
import { PreviewRail } from "./motion/preview-rail";
import { MessageBubble, MessageBubbleContent } from "./agents/message-bubble";
import { Markdown } from "./markdown";
import { ToolRow } from "./tool-row";
function Group({
  group,
  state,
  decisions,
  waiting,
}: {
  group: PromptGroup;
  state: TranscriptState;
  decisions: PermissionDecision[];
  waiting: boolean;
}) {
  const t = useAppText();
  const failed =
    group.status === "failed" ||
    group.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.content.some(
          (block) =>
            block.type === "toolCall" &&
            state.tools[presentationCallId(message, block.id)]?.status === "error",
        ),
    );
  const [expanded, setExpanded] = useState(failed);
  useEffect(() => {
    if (failed) setExpanded(true);
  }, [failed]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (group.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [group.status]);
  const open = group.status === "running" || group.status === "aborted" || expanded;
  const user = group.messages.find((message) => message.role === "user");
  const final = group.messages.findLast(
    (message) => message.role === "assistant" && messageText(message),
  );
  const duration =
    group.durationMs ??
    Math.max(
      0,
      (group.status === "running" ? now : (group.messages.at(-1)?.timestamp ?? group.startedAt)) -
        group.startedAt,
    );
  const content = open ? group.messages : final ? [final] : [];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-4">
      {user ? (
        <MessageBubble align="end">
          <MessageBubbleContent>
            <div className="whitespace-pre-wrap break-words">{messageText(user)}</div>
            {Array.isArray(user.content)
              ? user.content
                  .filter((block) => block.type === "image")
                  .map((image, index) => (
                    <img
                      key={index}
                      alt={
                        "imageNames" in user
                          ? (user.imageNames?.[index] ?? t("app.images"))
                          : t("app.images")
                      }
                      src={`data:${image.mimeType};base64,${image.data}`}
                      className="max-h-40 rounded-md"
                    />
                  ))
              : null}
          </MessageBubbleContent>
        </MessageBubble>
      ) : null}
      <div className="flex items-center gap-2 text-ui-sm text-muted-foreground">
        <span>
          {t(
            group.status === "running"
              ? waiting
                ? "app.waiting"
                : "conversation.running"
              : group.status === "aborted"
                ? "conversation.aborted"
                : group.status === "failed"
                  ? "conversation.failed"
                  : "conversation.complete",
          )}
        </span>
        <span>{t("conversation.duration", { duration: (duration / 1000).toFixed(1) })}</span>
        {group.status !== "running" ? (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {t(expanded ? "conversation.collapse" : "conversation.expand")}
          </Button>
        ) : null}
      </div>
      {group.error ? (
        <p role="alert" className="text-ui-sm text-danger">
          {group.error}
        </p>
      ) : null}
      {decisions
        .filter((item) => item.groupId === group.id)
        .map((item, index) => (
          <div key={index} className="flex items-baseline gap-2 text-ui-sm text-muted-foreground">
            {item.reply === "deny" ? (
              <CircleX aria-hidden className="size-3 shrink-0 text-danger" />
            ) : (
              <CircleCheck aria-hidden className="size-3 shrink-0 text-success" />
            )}
            <span>{t("conversation.decision", { decision: t(`conversation.${item.reply}`) })}</span>
            {item.origin ? <span>{item.origin}</span> : null}
            <code className="min-w-0 break-words font-mono">{item.title}</code>
          </div>
        ))}
      {content.map((message, index) => {
        if (message.role === "user") return null;
        if (message.role === "assistant")
          return (
            <div key={message.entryId ?? index}>
              {message.content.map((block, i) =>
                block.type === "text" ? (
                  <Markdown key={i} text={block.text} streaming={group.status === "running"} />
                ) : block.type === "thinking" ? (
                  open ? (
                    <details key={i}>
                      <summary className="text-ui-sm text-muted-foreground">
                        {t("conversation.thinking")}
                      </summary>
                      <Markdown text={block.thinking} />
                    </details>
                  ) : null
                ) : block.type === "toolCall" &&
                  state.tools[presentationCallId(message, block.id)] &&
                  open ? (
                  <div key={block.id}>
                    <ToolRow tool={state.tools[presentationCallId(message, block.id)]!} />
                  </div>
                ) : null,
              )}
            </div>
          );
        return null;
      })}
    </div>
  );
}
export function Transcript({
  state,
  decisions,
  waiting,
}: {
  state: TranscriptState;
  decisions: PermissionDecision[];
  waiting: boolean;
}) {
  const t = useAppText();
  const viewport = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [selected, setSelected] = useState<string>();
  const virtual = useVirtualizer({
    count: state.groups.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 200,
    getItemKey: (index) => state.groups[index]!.id,
    overscan: 2,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 56,
  });
  const items = virtual.getVirtualItems();
  return (
    <div className="relative flex min-h-0 flex-1">
      <div
        role="feed"
        aria-label={t("conversation.feed")}
        aria-busy={state.active}
        ref={viewport}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={() => {
          const element = viewport.current;
          if (element)
            setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight <= 56);
        }}
      >
        <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
          {items.map((item) => {
            const group = state.groups[item.index]!;
            return (
              <article
                key={item.key}
                data-index={item.index}
                ref={virtual.measureElement}
                aria-label={t("conversation.group", { index: item.index + 1 })}
                aria-posinset={item.index + 1}
                aria-setsize={state.groups.length}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <Group group={group} state={state} decisions={decisions} waiting={waiting} />
              </article>
            );
          })}
        </div>
      </div>
      {state.groups.length > 1 ? (
        <div className="pointer-events-none absolute bottom-12 left-0 top-3 hidden w-12 overflow-y-auto md:block">
          <PreviewRail
            className="pointer-events-auto min-h-0"
            items={state.groups.map((group, index) => ({
              id: group.id,
              label: t("conversation.group", { index: index + 1 }),
              ariaLabel: t("conversation.jump", { index: index + 1 }),
              description: (
                <div className="line-clamp-5">
                  {messageText(group.messages.find((message) => message.role === "user") ?? {})}
                  <br />
                  {messageText(
                    group.messages.findLast((message) => message.role === "assistant") ?? {},
                  )}
                </div>
              ),
            }))}
            activeId={selected}
            label={t("conversation.navigation")}
            itemSize={12}
            onItemSelect={(item) => {
              setSelected(item.id);
              virtual.scrollToIndex(
                state.groups.findIndex((group) => group.id === item.id),
                { align: "start" },
              );
            }}
          />
        </div>
      ) : null}
      {!following ? (
        <div className="absolute bottom-3 right-4">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => virtual.scrollToIndex(state.groups.length - 1, { align: "end" })}
          >
            {t("conversation.latest")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
