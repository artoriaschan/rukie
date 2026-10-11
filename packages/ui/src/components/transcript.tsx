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
import { AgentActivity, type AgentActivityItem } from "./agents/agent-activity";
import { StreamingResponse } from "./agents/streaming-response";
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
  const [expanded, setExpanded] = useState(
    group.status === "running" || group.status === "aborted" || failed,
  );
  useEffect(() => {
    if (failed || group.status === "running" || group.status === "aborted") setExpanded(true);
  }, [failed, group.status]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (group.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [group.status]);
  const user = group.messages.find((message) => message.role === "user");
  const final = group.messages
    .filter((message) => message.role === "assistant")
    .findLast(
      (message) =>
        messageText(message) && !message.content.some((block) => block.type === "toolCall"),
    );
  const duration =
    group.durationMs ??
    Math.max(
      0,
      (group.status === "running" ? now : (group.messages.at(-1)?.timestamp ?? group.startedAt)) -
        group.startedAt,
    );
  const elapsed =
    duration >= 60000
      ? t("conversation.duration-minutes", {
          minutes: Math.floor(duration / 60000),
          seconds: Math.floor(duration / 1000) % 60,
        })
      : t("conversation.duration", { duration: (duration / 1000).toFixed(1) });
  const title = (
    <span className="flex items-center gap-2 text-ui-sm text-muted-foreground">
      {(group.status === "running" && waiting) ||
      group.status === "aborted" ||
      group.status === "failed" ? (
        <span>
          {t(
            group.status === "running"
              ? "app.waiting"
              : group.status === "aborted"
                ? "conversation.aborted"
                : "conversation.failed",
          )}
        </span>
      ) : null}
      <span>
        {t(group.status === "running" ? "conversation.processing" : "conversation.elapsed", {
          duration: elapsed,
        })}
      </span>
    </span>
  );
  const activity: AgentActivityItem[] = [];
  for (const message of group.messages) {
    if (message.role !== "assistant") continue;
    message.content.forEach((block, index) => {
      const id = `${message.entryId ?? `partial-${message.timestamp}`}:${index}`;
      if (block.type === "thinking")
        activity.push({
          id,
          type: "trace",
          kind: "thinking",
          label: t("conversation.thinking"),
          content: <Markdown text={block.thinking} streaming={group.status === "running"} />,
        });
      else if (block.type === "text" && message !== final)
        activity.push({
          id,
          type: "trace",
          kind: "message",
          label: t("conversation.message"),
          content: (
            <StreamingResponse
              status={
                message === state.partial && group.status === "running" ? "streaming" : "complete"
              }
              showActions={false}
            >
              <Markdown
                text={block.text}
                streaming={message === state.partial && group.status === "running"}
              />
            </StreamingResponse>
          ),
        });
      else if (block.type === "toolCall") {
        const tool = state.tools[presentationCallId(message, block.id)];
        if (tool)
          activity.push({
            id,
            type: "trace",
            kind:
              tool.callView?.kind === "execute"
                ? "run"
                : tool.callView?.kind === "edit"
                  ? "write"
                  : (tool.callView?.kind ?? "other"),
            label: <ToolRow tool={tool} />,
          });
      }
    });
  }
  decisions
    .filter((item) => item.groupId === group.id)
    .forEach((item, index) => {
      activity.push({
        id: `permission-${index}`,
        type: "trace",
        kind: "permission",
        icon:
          item.reply === "deny" ? (
            <CircleX className="size-4 text-danger" />
          ) : (
            <CircleCheck className="size-4 text-success" />
          ),
        label: (
          <div className="flex items-baseline gap-2 text-ui-sm text-muted-foreground">
            <span>{t("conversation.decision", { decision: t(`conversation.${item.reply}`) })}</span>
            {item.origin ? <span>{item.origin}</span> : null}
            <code className="min-w-0 break-words font-mono">{item.title}</code>
          </div>
        ),
      });
    });
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
      <AgentActivity
        items={activity}
        contentType="trace"
        maxHeight={null}
        showStatusDivider
        status={group.status === "running" ? "working" : "complete"}
        duration={duration / 1000}
        open={expanded}
        onOpenChange={setExpanded}
        collapsibleWhileWorking
        collapseOnComplete={!failed && group.status !== "aborted"}
        renderWorkingStatus={() => title}
        renderCompletedStatus={() => title}
      />
      {group.error ? (
        <p role="alert" className="text-ui-sm text-danger">
          {group.error}
        </p>
      ) : null}
      {final ? (
        <StreamingResponse
          status={
            group.status === "running"
              ? "streaming"
              : group.status === "failed"
                ? "error"
                : "complete"
          }
          showActions={false}
        >
          <Markdown text={messageText(final)} streaming={group.status === "running"} />
        </StreamingResponse>
      ) : null}
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
  const currentGroup =
    state.groups.findLast((group) => group.status === "running") ?? state.groups.at(-1);
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
            activeId={currentGroup?.id}
            highlightActive
            label={t("conversation.navigation")}
            itemSize={12}
            onItemSelect={(item) => {
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
