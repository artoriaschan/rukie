import type { ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import { MorphingModal } from "../components/motion/morphing-modal";
import { Button } from "../components/motion/button/base";
import { cn } from "../lib/utils";
import { useComponentText } from "../lib/i18n";

/** Project-specific chrome; the shared modal's other consumers retain their geometry. */
export function ProjectDialog({
  title,
  width,
  initialFocus,
  pending = false,
  onClose,
  children,
}: {
  title: string;
  width: 416 | 448 | 480 | 520;
  initialFocus?: RefObject<HTMLElement | null>;
  pending?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useComponentText();
  return (
    <MorphingModal
      padding="project"
      viewId="project"
      label={title}
      placement="center"
      initialFocus={initialFocus}
      onClose={onClose}
      className={cn(
        "project-dialog",
        { 416: "max-w-[416px]", 448: "max-w-[448px]", 480: "max-w-[480px]", 520: "max-w-[520px]" }[
          width
        ],
      )}
    >
      {/* Passive clicks keep Escape inside this dialog without adding a Tab stop. */}
      <div className="flex min-h-0 flex-col gap-3" tabIndex={-1} aria-busy={pending}>
        <div className="flex h-8 shrink-0 items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 truncate text-ui-lg font-medium" title={title}>
            {title}
          </h2>
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            aria-label={t("component.close")}
            disabled={pending}
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        {children}
      </div>
    </MorphingModal>
  );
}
