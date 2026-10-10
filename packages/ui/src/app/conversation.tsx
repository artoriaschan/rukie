import { useState } from "react";
import type { WirePermissionRequest } from "@rukie/shared";
import type { ConversationProps } from "./index";
import { WireError } from "../client";
import { Transcript } from "../components/transcript";
import { PermissionDock, QueuedInputs, Summary } from "../components/conversation-dock";
import { useAppText } from "../lib/i18n";
import type { QueuedInput } from "@rukie/agent";
function queued(value: unknown): value is QueuedInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "requestId" in value &&
    typeof value.requestId === "string" &&
    "prompt" in value &&
    typeof value.prompt === "string" &&
    "images" in value &&
    Array.isArray(value.images) &&
    value.images.every(
      (image) =>
        typeof image === "object" &&
        image !== null &&
        typeof image.data === "string" &&
        typeof image.mimeType === "string" &&
        (image.name === undefined || typeof image.name === "string"),
    )
  );
}
export function AppConversation({
  sessionId,
  view,
  connected,
  summaryOpen,
  onCloseSummary,
  request,
  onDraft,
  onImages,
  onInteractionResolved,
}: ConversationProps) {
  const t = useAppText();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const state = view.transcript;
  const reply = async (
    permission: WirePermissionRequest,
    answer: "allow" | "deny" | "allow-session",
  ) => {
    const epoch = permission.identity.epoch;
    const groupId = state?.groups.at(-1)?.id;
    const call = permission.callView;
    const args = permission.args;
    const title =
      call?.card === "terminal"
        ? call.command
        : call?.card === "diff"
          ? call.diffs.map((item) => item.path).join(", ")
          : typeof args === "object" &&
              args !== null &&
              "command" in args &&
              typeof args.command === "string"
            ? args.command
            : typeof args === "object" &&
                args !== null &&
                "path" in args &&
                typeof args.path === "string"
              ? args.path
              : permission.toolName;
    if (!connected || pending) return;
    setPending(epoch);
    setError("");
    try {
      await request({ type: "interaction.reply", identity: permission.identity, reply: answer });
      onInteractionResolved(
        epoch,
        groupId
          ? {
              groupId,
              reply: answer,
              title,
              origin: permission.origin?.description,
            }
          : undefined,
      );
    } catch (reason) {
      if (reason instanceof WireError && reason.code === "interaction_stale")
        onInteractionResolved(epoch);
      else setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(null);
    }
  };
  const queue = async (type: "steer_now" | "withdraw", requestId: string) => {
    if (!connected || pending) return;
    setPending(requestId);
    setError("");
    try {
      const result = await request({ type, sessionId, requestId });
      if (
        type === "withdraw" &&
        typeof result === "object" &&
        result !== null &&
        "input" in result &&
        queued(result.input)
      ) {
        const input = result.input;
        onDraft((previous) => [input.prompt, previous].filter(Boolean).join("\n\n"));
        onImages((previous) => [...input.images, ...previous]);
      }
    } catch (reason) {
      if (!(reason instanceof WireError && reason.code === "not_queued"))
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {state ? (
        <div className={summaryOpen ? "flex min-h-0 flex-1 md:pr-80" : "flex min-h-0 flex-1"}>
          <Transcript
            state={state}
            decisions={Object.values(view.permissionDecisions ?? {})}
            waiting={Object.keys(view.interactions).length > 0}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-5 text-ui-sm text-danger">
          {t("app.error", { message: error })}
        </p>
      ) : null}
      {summaryOpen && state ? (
        <Summary
          toolStates={state.toolStates}
          background={state.background}
          onClose={onCloseSummary}
        />
      ) : null}
      <PermissionDock
        requests={Object.values(view.interactions)}
        connected={connected}
        pending={pending}
        shortcutsEnabled={!summaryOpen}
        onReply={(permission, answer) => {
          void reply(permission, answer);
        }}
      />
      {state ? (
        <QueuedInputs
          items={state.queued}
          disabled={!connected || pending !== null}
          onSteer={(id) => {
            void queue("steer_now", id);
          }}
          onWithdraw={(id) => {
            void queue("withdraw", id);
          }}
        />
      ) : null}
    </div>
  );
}
