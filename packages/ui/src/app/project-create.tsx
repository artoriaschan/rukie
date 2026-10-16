import { useRef } from "react";
import { Folder, FolderPlus, Plus } from "lucide-react";
import { Button } from "../components/motion/button/base";
import { Input } from "../components/motion/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { ProjectDialog } from "./project-dialog";
import { ProjectDirectories } from "./project-directories";
import { useAppText } from "../lib/i18n";

export function ProjectCreate({
  name,
  directories,
  primary,
  error,
  picking,
  connected,
  onName,
  onPick,
  onPrimary,
  onRemove,
  onCreate,
  onClose,
}: {
  name: string;
  directories: string[];
  primary: string;
  error: string;
  picking: boolean;
  connected: boolean;
  onName: (name: string) => void;
  onPick: () => void;
  onPrimary: (path: string) => void;
  onRemove: (path: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const t = useAppText();
  const nameInput = useRef<HTMLInputElement>(null);
  return (
    <ProjectDialog
      title={t("app.create-project")}
      width={480}
      initialFocus={nameInput}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
        className="flex min-h-0 flex-col gap-3"
      >
        <Input
          size="scoped"
          autoFocus
          ref={nameInput}
          aria-label={t("app.project-name")}
          placeholder={t("app.project-name")}
          maxLength={128}
          leftIcon={<Folder />}
          value={name}
          onChange={onName}
        />
        <h3 className="shrink-0 text-ui-base font-medium">{t("app.source-folders")}</h3>
        {directories.length ? (
          <ScrollArea
            className="project-directory-list rounded-xl border border-border"
            viewportLabel={t("app.source-folders")}
          >
            <ProjectDirectories
              directories={directories}
              primary={primary}
              onPrimary={onPrimary}
              onRemove={(directory) => {
                onRemove(directory);
                // The removed control loses focus before Escape can reach the dialog.
                nameInput.current?.focus();
              }}
              disabled={picking}
            />
            <Button
              size="compact"
              variant="ghost"
              className="h-8 w-full justify-start rounded-none border-t border-border"
              disabled={picking}
              onClick={onPick}
            >
              <Plus />
              {t("app.add-folder")}
            </Button>
          </ScrollArea>
        ) : (
          <Button
            size="standard"
            variant="outline"
            className="h-[104px] shrink-0 flex-col gap-3 rounded-xl"
            disabled={picking}
            onClick={onPick}
          >
            <FolderPlus className="size-3" />
            {t("app.add-folders-empty")}
          </Button>
        )}
        {error ? (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex shrink-0 justify-end gap-2">
          <Button size="compact" variant="ghost" onClick={onClose}>
            {t("app.cancel")}
          </Button>
          <Button
            size="standard"
            type="submit"
            className="h-9"
            disabled={!name.trim() || !directories.length || !connected || picking}
          >
            {t("app.create-project")}
          </Button>
        </div>
      </form>
    </ProjectDialog>
  );
}
