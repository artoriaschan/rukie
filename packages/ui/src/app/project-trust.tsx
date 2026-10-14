import { useRef, useState } from "react";
import type { WireProject } from "@rukie/shared";
import { MorphingModal } from "../components/motion/morphing-modal";
import { Button } from "../components/motion/button/base";
import { ScrollArea } from "../components/ui/scroll-area";
import { useAppText } from "../lib/i18n";
import { useErrorText } from "./error";

/** Compose installed beUI controls: Project trust has directory-specific content. */
export function ProjectTrust({
  project,
  creating = false,
  onConfirm,
  onCancel,
}: {
  project: Pick<WireProject, "directories" | "primary">;
  creating?: boolean;
  onConfirm: () => Promise<unknown>;
  onCancel: () => void;
}) {
  const t = useAppText();
  const errorText = useErrorText();
  const cancel = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!submitting.current) onCancel();
  };
  return (
    <MorphingModal
      viewId="project-trust"
      label={t("app.trust-title")}
      placement="center"
      initialFocus={cancel}
      onClose={close}
    >
      <div className="flex min-h-0 flex-col gap-3" aria-busy={pending}>
        <h2 className="shrink-0 text-ui-lg font-medium">{t("app.trust-title")}</h2>
        <ScrollArea
          className="min-h-0 flex-1"
          viewportLabel={t("app.project-directories")}
          viewportClassName="space-y-3 [contain:inline-size]"
        >
          <ul className="space-y-2">
            {project.directories.map((directory) => (
              <li key={directory} className="flex items-center gap-2 text-ui-base">
                <span className="min-w-0 flex-1 break-all">{directory}</span>
                {directory === project.primary ? (
                  <span className="shrink-0 text-ui-caption text-muted-foreground">
                    {t("app.primary")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-ui-base text-muted-foreground">{t("app.trust-primary")}</p>
          {project.directories.length > 1 ? (
            <p className="text-ui-base text-muted-foreground">{t("app.trust-additional")}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {error}
            </p>
          ) : null}
        </ScrollArea>
        <div className="flex shrink-0 justify-end gap-2">
          <Button ref={cancel} variant="secondary" disabled={pending} onClick={close}>
            {t("app.cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (submitting.current) return;
              submitting.current = true;
              setPending(true);
              setError("");
              void onConfirm()
                .catch((reason) => setError(errorText(reason)))
                .finally(() => {
                  submitting.current = false;
                  setPending(false);
                });
            }}
          >
            {t(creating ? "app.trust-create" : "app.trust")}
          </Button>
        </div>
      </div>
    </MorphingModal>
  );
}

/** Directory-specific rows composed from the shared Button; reveal reserves action space. */
export function ProjectDirectories({
  directories,
  primary,
  onPrimary,
  disabled = false,
}: {
  directories: string[];
  primary: string;
  onPrimary: (directory: string) => void;
  disabled?: boolean;
}) {
  const t = useAppText();
  return (
    <ul className="space-y-2">
      {directories.map((directory) => (
        <li
          key={directory}
          tabIndex={0}
          className="group/directory flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1 break-all text-ui-base">{directory}</span>
          {directory === primary ? (
            <span className="shrink-0 text-ui-caption text-muted-foreground">
              {t("app.primary")}
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${t("app.set-primary")} ${directory}`}
              className="shrink-0 opacity-0 group-hover/directory:opacity-100 group-focus-within/directory:opacity-100"
              disabled={disabled}
              onClick={() => onPrimary(directory)}
            >
              {t("app.set-primary")}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
