import { useEffect, useRef, useState } from "react";
import { MorphingModal } from "../components/motion/morphing-modal";
import { Button } from "../components/motion/button/base";
import { useAppText } from "../lib/i18n";
import { useErrorText } from "./error";
import "../components/goal-mode.css";

export function GoalConfirmation({
  onClose,
  intent = "enable",
  onConfirm,
}: {
  intent?: "enable" | "remove";
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useAppText();
  const errorText = useErrorText();
  const [error, setError] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    cancel.current?.focus();
  }, [pending]);
  const removing = intent === "remove";
  const title = t(removing ? "app.goal-remove-title" : "app.goal-confirm-title");
  return (
    <MorphingModal
      padding="goal"
      viewId={intent}
      placement="center"
      label={title}
      initialFocus={cancel}
      onClose={onClose}
      className="goal-confirmation"
    >
      <div
        className={
          removing ? "goal-confirmation-content goal-removal-content" : "goal-confirmation-content"
        }
      >
        <h2 className="text-ui-lg font-medium">{title}</h2>
        <p className="text-ui-base text-muted-foreground">
          {t(removing ? "app.goal-remove-description" : "app.goal-confirm-description")}
        </p>
        {error ? (
          <p role="alert" className="text-ui-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="goal-confirmation-footer">
        <Button
          geometry="goal"
          size={removing ? "compact" : "standard"}
          ref={cancel}
          variant="secondary"
          onClick={onClose}
        >
          {t("app.cancel")}
        </Button>
        <Button
          geometry="goal"
          size="standard"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setError("");
            void onConfirm()
              .catch((reason) => setError(t("app.error", { message: errorText(reason) })))
              .finally(() => setPending(false));
          }}
        >
          {t(removing ? "app.goal-delete" : "app.goal-confirm")}
        </Button>
      </div>
    </MorphingModal>
  );
}
