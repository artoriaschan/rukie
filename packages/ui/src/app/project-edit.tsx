import { useRef, useState } from "react";
import type { WireProject } from "@rukie/shared";
import { Folder, Plus } from "lucide-react";
import { WireError } from "../client";
import { Button } from "../components/motion/button/base";
import { Input } from "../components/motion/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { useAppText } from "../lib/i18n";
import { useErrorText } from "./error";
import { ProjectDialog } from "./project-dialog";
import { ProjectDirectories, removeProjectDirectory } from "./project-directories";
import { ProjectTrust } from "./project-trust";

/** A mounted editor owns its draft; confirmation cancellation keeps it, closing discards it. */
export function ProjectEdit({
  project,
  busy,
  connected,
  onPick,
  onSave,
  onRemove,
  onClose,
}: {
  project: WireProject;
  busy: boolean;
  connected: boolean;
  onPick: () => Promise<string[] | null>;
  onSave: (draft: {
    name: string;
    directories: string[];
    primary: string;
    trusted?: true;
  }) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useAppText();
  const errorText = useErrorText();
  const nameInput = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [name, setName] = useState(project.name);
  const [directories, setDirectories] = useState(project.directories);
  const [primary, setPrimary] = useState(project.primary);
  const [view, setView] = useState<"edit" | "trust" | "remove">("edit");
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const addedDirectories = directories.filter(
    (directory) => !project.directories.includes(directory),
  );
  const changed =
    name.trim() !== project.name ||
    primary !== project.primary ||
    directories.length !== project.directories.length ||
    directories.some((directory, index) => directory !== project.directories[index]);
  const canSave = Boolean(name.trim() && changed && connected && !picking && !pending);
  const close = () => {
    if (!submitting.current) onClose();
  };
  const back = () => {
    if (!submitting.current) {
      setError("");
      setView("edit");
    }
  };
  const save = async (trusted?: true) => {
    if (!canSave || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await onSave({ name: name.trim(), directories, primary, ...(trusted && { trusted }) });
      onClose();
    } catch (reason) {
      setError(errorText(reason));
      setView("edit");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  const pick = async () => {
    if (picking || submitting.current) return;
    setPicking(true);
    setError("");
    try {
      const selected = await onPick();
      if (selected?.length) setDirectories((previous) => [...new Set([...previous, ...selected])]);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setPicking(false);
    }
  };
  const remove = async () => {
    if (busy || !connected || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await onRemove();
      onClose();
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
  if (view === "trust")
    return (
      <ProjectTrust
        project={{ directories, primary }}
        saving
        addedDirectories={addedDirectories}
        onConfirm={() => save(true)}
        onCancel={back}
      />
    );
  if (view === "remove")
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
          <Button autoFocus ref={cancel} variant="ghost" disabled={pending} onClick={back}>
            {t("app.cancel")}
          </Button>
          <Button
            className="h-9 bg-destructive-soft text-destructive-soft-foreground not-disabled:hover:bg-destructive-soft/80 not-disabled:active:bg-destructive-soft"
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
  return (
    <ProjectDialog
      title={t("app.edit-project")}
      width={520}
      initialFocus={nameInput}
      pending={pending}
      onClose={close}
    >
      <form
        className="flex min-h-0 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          if (project.trusted && addedDirectories.length) {
            setError("");
            setView("trust");
          } else void save();
        }}
      >
        <Input
          autoFocus
          ref={nameInput}
          aria-label={t("app.project-name")}
          maxLength={128}
          leftIcon={<Folder />}
          value={name}
          onChange={setName}
          disabled={pending}
        />
        <h3 className="shrink-0 text-ui-base font-medium">{t("app.source-folders")}</h3>
        <ScrollArea
          className="project-directory-list rounded-xl border border-border"
          viewportLabel={t("app.source-folders")}
        >
          <ProjectDirectories
            directories={directories}
            primary={primary}
            disabled={picking || pending}
            onPrimary={setPrimary}
            onRemove={(directory) => {
              const next = removeProjectDirectory(directories, primary, directory);
              setDirectories(next.directories);
              setPrimary(next.primary);
              // The clicked folder control disappears; keep keyboard cancellation inside the modal.
              nameInput.current?.focus();
            }}
          />
          <Button
            variant="ghost"
            className="h-8 w-full justify-start rounded-none border-t border-border"
            disabled={picking || pending}
            onClick={() => {
              void pick();
            }}
          >
            <Plus />
            {t("app.add-folder")}
          </Button>
        </ScrollArea>
        {error ? (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        ) : null}
        {busy ? (
          <p id="project-remove-busy" className="text-ui-sm text-muted-foreground">
            {t("app.remove-project-busy")}
          </p>
        ) : null}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <Button
            variant="destructive"
            className="h-8"
            aria-describedby={busy ? "project-remove-busy" : undefined}
            disabled={busy || pending || picking || !connected}
            onClick={() => {
              setError("");
              setView("remove");
            }}
          >
            {t("app.remove-local-project")}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" disabled={pending} onClick={close}>
              {t("app.cancel")}
            </Button>
            <Button type="submit" className="h-9" disabled={!canSave}>
              {t("app.save")}
            </Button>
          </div>
        </div>
      </form>
    </ProjectDialog>
  );
}
