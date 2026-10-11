import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Sparkles, SquareTerminal, Wrench } from "lucide-react";
import { AgentDisclosure } from "./agents/agent-disclosure";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PromptGroup, TranscriptState, PermissionDecision } from "../lib/transcript";
import { messageText, presentationCallId, toolTitle } from "../lib/transcript";
import { useAppText } from "../lib/i18n";
import { Button } from "./motion/button/base";
import { PreviewRail } from "./motion/preview-rail";
import { MessageBubble, MessageBubbleContent } from "./agents/message-bubble";
import { Markdown } from "./markdown";
import { ToolRow } from "./tool-row";
import { ToolApproval, ToolApprovalCode } from "./agents/tool-approval";
import { AgentActivity, type AgentActivityItem } from "./agents/agent-activity";
import { ThinkingShimmer } from "./agents/loading-states/thinking-shimmer";
import { TextShimmer } from "./motion/text-shimmer";
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
  const finalMessage = group.messages.findLast(
    (message) =>
      message.role === "assistant" &&
      messageText(message).trim() &&
      !message.content.some((block) => block.type === "toolCall"),
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
      {group.status === "running" ? (
        <ThinkingShimmer className="text-ui-sm font-normal">
          {t("conversation.processing", { duration: elapsed })}
        </ThinkingShimmer>
      ) : (
        <span>{t("conversation.elapsed", { duration: elapsed })}</span>
      )}
    </span>
  );
  type TraceActivity = { item: AgentActivityItem; headerDetail?: string; active?: boolean };
  const sections: Array<
    | {
        id: string;
        type: "trace";
        items: TraceActivity[];
      }
    | { id: string; type: "message"; content: ReactNode }
  > = [];
  const appendActivity = (item: AgentActivityItem, header: Omit<TraceActivity, "item"> = {}) => {
    const activity = { item, ...header };
    const last = sections.at(-1);
    if (last?.type === "trace") last.items.push(activity);
    else sections.push({ id: item.id, type: "trace", items: [activity] });
  };
  const approvals = decisions
    .filter((item) => item.request.placement?.groupId === group.id)
    .map((item) => {
      const placement = item.request.placement!;
      const anchor = group.messages.find((candidate) =>
        placement.entryId
          ? candidate.entryId === placement.entryId
          : candidate.timestamp === placement.timestamp,
      );
      return { item, anchor };
    });
  const appendApprovals = (
    message: (typeof group.messages)[number],
    blockIndex: number,
    before: boolean,
  ) => {
    for (const { item, anchor } of approvals) {
      const placement = item.request.placement!;
      if (anchor !== message || placement.blockIndex !== blockIndex || placement.before !== before)
        continue;
      const request = item.request;
      appendActivity({
        id: `permission-${request.identity.epoch}`,
        type: "trace",
        kind: "permission",
        icon: null,
        label: (
          <ToolApproval
            tool={request.toolName}
            title={t("conversation.decision", { decision: t(`conversation.${item.reply}`) })}
            status={item.reply === "deny" ? "denied" : "approved"}
            description={request.origin?.description ?? request.reason}
            parameters={[
              {
                id: "command",
                label: request.toolName,
                value: (
                  <ToolApprovalCode
                    code={
                      request.callView?.card === "terminal"
                        ? request.callView.command
                        : (JSON.stringify(request.args, null, 2) ?? "")
                    }
                    language={request.callView?.card === "terminal" ? "bash" : "json"}
                  />
                ),
              },
            ]}
          />
        ),
      });
    }
  };
  for (const message of group.messages) {
    if (message.role !== "assistant") {
      appendApprovals(message, -1, false);
      continue;
    }
    if (!message.content.length) appendApprovals(message, -1, false);
    message.content.forEach((block, index) => {
      appendApprovals(message, index, true);
      const id = `${message.entryId ?? `partial-${message.timestamp}`}:${index}`;
      if (block.type === "thinking")
        appendActivity(
          {
            id,
            type: "trace",
            kind: "thinking",
            collapsible: true,
            label: t("conversation.thinking"),
            content: <Markdown text={block.thinking} streaming={group.status === "running"} />,
          },
          {
            headerDetail: `${t("conversation.thinking")} · ${block.thinking.replace(/\s+/g, " ").trim()}`,
            active:
              group.status === "running" &&
              message === state.partial &&
              index === message.content.length - 1,
          },
        );
      else if (block.type === "text" && block.text.trim())
        sections.push({
          id,
          type: "message",
          content: (
            <StreamingResponse
              status={
                message === state.partial && group.status === "running"
                  ? "streaming"
                  : message === finalMessage && group.status === "failed"
                    ? "error"
                    : "complete"
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
          appendActivity(
            {
              id,
              type: "trace",
              kind:
                tool.callView?.kind === "execute"
                  ? "run"
                  : tool.callView?.kind === "edit"
                    ? "write"
                    : (tool.callView?.kind ?? "other"),
              icon: null,
              label: <ToolRow tool={tool} />,
            },
            {
              active: group.status === "running" && tool.status === "running",
              headerDetail: `${t(tool.status === "running" ? `conversation.active-${tool.callView?.kind ?? "other"}` : `conversation.action-${tool.callView?.kind ?? "other"}`)} · ${toolTitle(tool).replace(/\s+/g, " ").trim()}`,
            },
          );
      }
      appendApprovals(message, index, false);
    });
  }
  return (
    <div className="mx-auto flex min-w-0 max-w-3xl flex-col gap-2 px-5 py-3">
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
        items={[]}
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
        renderContent={({ expanded: activityOpen, contentId, triggerId }) => (
          <div id={contentId} role="region" aria-labelledby={triggerId} className="space-y-2 py-1">
            {sections.map((section) => {
              if (section.type === "message") return <div key={section.id}>{section.content}</div>;
              const working = section.items.some((item) => item.active);
              const latestDetail = section.items.findLast(
                (item) => item.headerDetail,
              )?.headerDetail;
              const kinds = new Set(
                section.items.flatMap(({ item }) =>
                  item.type === "trace" && item.kind !== "thinking" && item.kind !== "permission"
                    ? [item.kind]
                    : [],
                ),
              );
              const summary = kinds.size
                ? [...kinds]
                    .map((kind) => {
                      const category =
                        kind === "run"
                          ? "execute"
                          : kind === "write"
                            ? "edit"
                            : kind === "read"
                              ? "read"
                              : kind === "search"
                                ? "search"
                                : kind === "fetch"
                                  ? "fetch"
                                  : kind === "task"
                                    ? "task"
                                    : "other";
                      return t(`conversation.activity-${category}`);
                    })
                    .join(t("conversation.activity-separator"))
                : t("conversation.analyzed");
              const Icon = kinds.has("run")
                ? SquareTerminal
                : kinds.has("read")
                  ? FileText
                  : kinds.size
                    ? Wrench
                    : Sparkles;
              const label = (
                <span className="flex min-w-0 flex-1 items-center gap-2 text-ui-sm font-normal text-muted-foreground">
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {working && latestDetail ? (
                    <TextShimmer
                      title={latestDetail}
                      className="min-w-0 truncate text-ui-sm font-normal"
                    >
                      {latestDetail}
                    </TextShimmer>
                  ) : (
                    <span className="min-w-0 truncate" title={summary}>
                      {summary}
                    </span>
                  )}
                </span>
              );
              return (
                <AgentDisclosure key={section.id} open={activityOpen} data-trace-group="">
                  <AgentActivity
                    items={section.items.map(({ item }) => item)}
                    contentType="trace"
                    status={working ? "working" : "complete"}
                    defaultOpen={false}
                    collapseOnComplete={false}
                    collapsibleWhileWorking
                    maxHeight={null}
                    renderWorkingStatus={() => label}
                    renderCompletedStatus={() => label}
                    contentClassName="py-1"
                  />
                </AgentDisclosure>
              );
            })}
          </div>
        )}
      />
      {group.error ? (
        <p role="alert" className="text-ui-sm text-danger">
          {group.error}
        </p>
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
