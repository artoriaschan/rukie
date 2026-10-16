import { useRef, useState } from "react";
import type { WireProject } from "@rukie/shared";
import { WireError } from "../client";
import { Button } from "../components/motion/button/base";
import { useAppText } from "../lib/i18n";
import { useErrorText } from "./error";
import { ProjectDialog } from "./project-dialog";

/** C31 removal confirmation; the opener decides where cancellation returns. */
export function ProjectRemove({
  project,
  busy,
  connected,
  onRemove,
  onCancel,
  onRemoved,
}: {
  project: Pick<WireProject, "name">;
  busy: boolean;
  connected: boolean;
  onRemove: () => Promise<unknown>;
  onCancel: () => void;
  onRemoved: () => void;
}) {
  const t = useAppText();
  const errorText = useErrorText();
  const cancel = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const back = () => {
    if (!submitting.current) onCancel();
  };
  const remove = async () => {
    if (busy || !connected || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await onRemove();
      onRemoved();
    } catch (reason) {
      setError(
        reason instanceof WireError && reason.code === "session_busy"
          ? t("app.remove-project-busy")
          : errorText(reason),
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return (
    <ProjectDialog
      title={t("app.remove-project-title", { name: project.name })}
      width={448}
      initialFocus={cancel}
      pending={pending}
      onClose={back}
    >
      <p className="text-ui-base text-muted-foreground">{t("app.remove-project-description")}</p>
      {busy || error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error || t("app.remove-project-busy")}
        </p>
      ) : null}
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          size="standard"
          autoFocus
          ref={cancel}
          variant="ghost"
          disabled={pending}
          onClick={back}
        >
          {t("app.cancel")}
        </Button>
        <Button
          size="standard"
          variant="destructive"
          className="h-9 bg-destructive-soft text-destructive-soft-foreground not-disabled:hover:bg-destructive-soft/80"
          disabled={pending || busy || !connected}
          onClick={() => {
            void remove();
          }}
        >
          {t("app.remove-project")}
        </Button>
      </div>
    </ProjectDialog>
  );
}
