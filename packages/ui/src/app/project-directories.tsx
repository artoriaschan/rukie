import { AnimatedBadge } from "../components/motion/animated-badge";
import { Folder, X } from "lucide-react";
import { Button } from "../components/motion/button/base";
import { Tooltip } from "../components/motion/tooltip";
import { useAppText } from "../lib/i18n";

export function directoryName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Domain rows reuse installed controls and tooltip; the form owns all draft changes. */
export function ProjectDirectories({
  directories,
  primary,
  onPrimary,
  onRemove,
  disabled = false,
}: {
  directories: string[];
  primary: string;
  onPrimary: (directory: string) => void;
  onRemove?: (directory: string) => void;
  disabled?: boolean;
}) {
  const t = useAppText();
  return (
    <ul className="flex flex-col">
      {directories.map((directory) => {
        const name = directoryName(directory);
        const duplicate = directories.some(
          (other) => other !== directory && directoryName(other) === name,
        );
        const parent = directory.split(/[\\/]/).filter(Boolean).at(-2) ?? directory;
        return (
          <li
            key={directory}
            className="group/directory h-8 border-b border-border last:border-b-0"
          >
            <Tooltip
              layer="modalHint"
              content={directory}
              side="top"
              wrapperClassName="flex! h-full w-full"
              className="translate-y-1 border-none bg-path-tooltip p-2 text-path-tooltip-foreground break-all"
            >
              <div
                tabIndex={0}
                className="flex h-full min-w-0 w-full items-center gap-2 px-3 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-ui-base">
                  {name}
                  {duplicate ? (
                    <span className="ml-1 text-ui-caption text-muted-foreground">{parent}</span>
                  ) : null}
                </span>
                {directory === primary ? (
                  <AnimatedBadge
                    showIcon={false}
                    size="sm"
                    className="h-6 border-border bg-transparent text-foreground"
                  >
                    {t("app.primary")}
                  </AnimatedBadge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 min-h-6 shrink-0 py-0 text-ui-caption opacity-0 group-hover/directory:opacity-100 group-focus-within/directory:opacity-100"
                    aria-label={`${t("app.set-primary")} ${directory}`}
                    disabled={disabled}
                    onClick={() => onPrimary(directory)}
                  >
                    {t("app.set-primary")}
                  </Button>
                )}
                {onRemove ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 shrink-0 p-1"
                    aria-label={`${t("app.remove-folder")} ${directory}`}
                    disabled={disabled || directories.length === 1}
                    onClick={() => onRemove(directory)}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** Keep a nonempty ordered draft and promote the next directory when its primary is removed. */
export function removeProjectDirectory(directories: string[], primary: string, directory: string) {
  if (directories.length <= 1) return { directories, primary };
  const remaining = directories.filter((path) => path !== directory);
  return { directories: remaining, primary: primary === directory ? remaining[0]! : primary };
}
