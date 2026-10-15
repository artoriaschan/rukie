import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { WireProject, WireSessionSummary } from "@rukie/shared";
import { WireError } from "../client";
import { MorphingModal } from "../components/motion/morphing-modal";
import { Input } from "../components/motion/input";
import { Button } from "../components/motion/button/base";
import { useAppText } from "../lib/i18n";
import { useErrorText } from "./error";

type RenameCopy = {
  title: "app.rename-title" | "app.rename-project-title";
  input: "app.rename-input" | "app.project-name";
  close: "app.rename-close" | "app.rename-project-close";
};

/** Compose installed beUI controls; App owns selection and the wire mutation. */
function RenameDialog({
  id,
  value,
  copy,
  onSave,
  onClose,
}: {
  id: string;
  value: string;
  copy: RenameCopy;
  onSave: (value: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useAppText();
  const errorText = useErrorText();
  const [title, setTitle] = useState(value);
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
  const unchanged = normalized === value.trim();
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
    <MorphingModal viewId={id} label={t(copy.title)} onClose={close} placement="center">
      <form
        className="relative flex min-h-0 flex-col gap-3 p-2"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="shrink-0 pr-8">
          <h2 className="text-ui-lg font-medium">{t(copy.title)}</h2>
          <p className="text-ui-base text-muted-foreground">{t("app.rename-description")}</p>
        </div>
        <div className="min-h-0 overflow-y-auto">
          <Input
            autoFocus
            aria-label={t(copy.input)}
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
          <Button type="submit" disabled={pending || !normalized || unchanged}>
            {t("app.save")}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t(copy.close)}
          className="absolute right-0 top-0"
          disabled={pending}
          onClick={close}
        >
          <X />
        </Button>
      </form>
    </MorphingModal>
  );
}

export function RenameSession({
  session,
  onSave,
  onClose,
}: {
  session: WireSessionSummary;
  onSave: (title: string) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <RenameDialog
      id={session.id}
      value={session.title}
      copy={{ title: "app.rename-title", input: "app.rename-input", close: "app.rename-close" }}
      onSave={onSave}
      onClose={onClose}
    />
  );
}

/** Renaming keeps the Project's directories and primary; only its name changes. */
export function RenameProject({
  project,
  onSave,
  onClose,
}: {
  project: WireProject;
  onSave: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <RenameDialog
      id={project.id}
      value={project.name}
      copy={{
        title: "app.rename-project-title",
        input: "app.project-name",
        close: "app.rename-project-close",
      }}
      onSave={onSave}
      onClose={onClose}
    />
  );
}
