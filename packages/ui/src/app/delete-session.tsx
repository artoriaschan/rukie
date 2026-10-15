import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { WireSessionSummary } from "@rukie/shared";
import { WireError } from "../client";
import { MorphingModal } from "../components/motion/morphing-modal";
import { ScrollArea } from "../components/ui/scroll-area";
import { Button } from "../components/motion/button/base";
import { useAppText } from "../lib/i18n";
import { useErrorText } from "./error";

/** Installed beUI dialog/buttons; cancellation is focused before the destructive action. */
export function DeleteSession({
  session,
  onDelete,
  onClose,
}: {
  session: WireSessionSummary;
  onDelete: () => Promise<unknown>;
  onClose: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const t = useAppText();
  const errorText = useErrorText();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const close = () => {
    if (!submitting.current) onClose();
  };
  const remove = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await onDelete();
      if (mounted.current) onClose();
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof WireError && reason.code === "session_busy"
            ? t("app.delete-busy")
            : errorText(reason),
        );
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <MorphingModal
      viewId={session.id}
      label={t("app.delete-title")}
      onClose={close}
      placement="center"
      initialFocus={cancel}
    >
      <div className="relative flex min-h-0 flex-col gap-3 p-2" aria-busy={pending}>
        <div className="shrink-0 pr-8">
          <h2 className="text-ui-lg font-medium">{t("app.delete-title")}</h2>
          <p className="text-ui-base text-muted-foreground">
            {t(
              session.projectId === null
                ? "app.delete-conversation-description"
                : "app.delete-description",
            )}
          </p>
        </div>
        <ScrollArea
          className="flex min-h-0 flex-1 flex-col [&>[data-slot=scroll-area-viewport]]:min-h-0"
          viewportLabel={t("app.delete-title")}
          viewportClassName="space-y-3 [contain:inline-size]"
        >
          <p className="break-words text-ui-base">{session.title}</p>
          {error ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {error}
            </p>
          ) : null}
        </ScrollArea>
        <div className="flex shrink-0 justify-end gap-2">
          <Button ref={cancel} autoFocus variant="secondary" disabled={pending} onClick={close}>
            {t("app.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={pending || session.running || session.waitingInteraction}
            onClick={() => {
              void remove();
            }}
          >
            {t("app.delete")}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("app.delete-close")}
          className="absolute right-0 top-0"
          disabled={pending}
          onClick={close}
        >
          <X />
        </Button>
      </div>
    </MorphingModal>
  );
}
