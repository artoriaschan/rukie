import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { WireSessionSummary } from "@rukie/shared";
import { WireError } from "../client";
import { MorphingModal } from "../components/motion/morphing-modal";
import { Input } from "../components/motion/input";
import { Button } from "../components/motion/button/base";
import { useAppText } from "../lib/i18n";
import { useErrorText } from "./error";

/** Compose installed beUI controls; App owns selection and the wire mutation. */
export function RenameSession({
  session,
  onSave,
  onClose,
}: {
  session: WireSessionSummary;
  onSave: (title: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useAppText();
  const errorText = useErrorText();
  const [title, setTitle] = useState(session.title);
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
  const normalized = title.trim();
  const unchanged = normalized === session.title.trim();
  const close = () => {
    if (!submitting.current) onClose();
  };
  const save = async () => {
    if (submitting.current || !normalized || unchanged) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await onSave(normalized);
      if (mounted.current) onClose();
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof WireError && reason.code === "session_busy"
            ? t("app.rename-busy")
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
      label={t("app.rename-title")}
      onClose={close}
      placement="center"
    >
      <form
        className="relative flex min-h-0 flex-col gap-3 p-2"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="shrink-0 pr-8">
          <h2 className="text-ui-lg font-medium">{t("app.rename-title")}</h2>
          <p className="text-ui-base text-muted-foreground">{t("app.rename-description")}</p>
        </div>
        <div className="min-h-0 overflow-y-auto">
          <Input
            autoFocus
            aria-label={t("app.rename-input")}
            value={title}
            onChange={setTitle}
            disabled={pending}
            onFocus={(event) => event.currentTarget.select()}
          />
          {error ? (
            <p role="alert" className="mt-2 text-ui-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2">
          <Button variant="secondary" disabled={pending} onClick={close}>
            {t("app.cancel")}
          </Button>
          <Button
            type="submit"
            className="[--primary:#000] [--primary-foreground:#fff] dark:[--primary:#fff] dark:[--primary-foreground:#000] not-disabled:hover:bg-primary not-disabled:active:bg-primary"
            disabled={pending || !normalized || unchanged}
          >
            {t("app.save")}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("app.rename-close")}
          className="absolute right-0 top-0"
          disabled={pending}
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </form>
    </MorphingModal>
  );
}
