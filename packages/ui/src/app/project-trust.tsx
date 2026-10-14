import { AnimatedBadge } from "../components/motion/animated-badge";
import { useRef, useState } from "react";
import type { WireProject } from "@rukie/shared";
import { Folder } from "lucide-react";
import { ProjectDialog } from "./project-dialog";
import { Button } from "../components/motion/button/base";
import { ScrollArea } from "../components/ui/scroll-area";
import { useAppText } from "../lib/i18n";
import { useErrorText } from "./error";

/** Compose installed beUI controls: Project trust has directory-specific content. */
export function ProjectTrust({
  project,
  creating = false,
  saving = false,
  addedDirectories = [],
  onConfirm,
  onCancel,
}: {
  project: Pick<WireProject, "directories" | "primary">;
  creating?: boolean;
  saving?: boolean;
  addedDirectories?: string[];
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
    <ProjectDialog
      title={t("app.trust-title")}
      width={416}
      initialFocus={cancel}
      pending={pending}
      onClose={close}
    >
      <ScrollArea
        className="project-directory-list rounded-xl border border-border"
        viewportLabel={t("app.project-directories")}
      >
        <ul className="flex flex-col">
          {project.directories.map((directory) => (
            <li
              key={directory}
              className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0"
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 break-all font-mono text-ui-sm">{directory}</span>
              {directory === project.primary ? (
                <AnimatedBadge showIcon={false} size="sm">
                  {t("app.primary")}
                </AnimatedBadge>
              ) : null}
              {addedDirectories.includes(directory) ? (
                <AnimatedBadge showIcon={false} size="sm">
                  {t("app.new-folder")}
                </AnimatedBadge>
              ) : null}
            </li>
          ))}
        </ul>
      </ScrollArea>
      <p className="text-ui-base text-muted-foreground">{t("app.trust-description")}</p>
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex shrink-0 flex-col gap-2">
        <Button
          className="h-9 w-full"
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
          {t(creating ? "app.trust-create" : saving ? "app.trust-save" : "app.trust")}
        </Button>
        <Button
          autoFocus
          ref={cancel}
          variant="secondary"
          className="h-8 w-full"
          disabled={pending}
          onClick={close}
        >
          {t("app.cancel")}
        </Button>
      </div>
    </ProjectDialog>
  );
}
