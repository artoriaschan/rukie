import { useEffect, useRef, useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import type { WireWorktree } from "@rukie/shared";
import { WireError, type ClientCommand } from "../client";
import { Button } from "../components/motion/button/base";
import { MorphingModal } from "../components/motion/morphing-modal";
import { useAppText } from "../lib/i18n";
import { useErrorText } from "./error";
import "./worktree-settings.css";

function parseWorktrees(value: unknown): WireWorktree[] {
  if (!Array.isArray(value)) throw new Error("Invalid worktrees reply");
  return value.map((item: unknown) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("id" in item) ||
      typeof item.id !== "string" ||
      !item.id ||
      !("projectId" in item) ||
      typeof item.projectId !== "string" ||
      !("repository" in item) ||
      typeof item.repository !== "string" ||
      !("branch" in item) ||
      typeof item.branch !== "string" ||
      !("path" in item) ||
      typeof item.path !== "string" ||
      !("createdAt" in item) ||
      typeof item.createdAt !== "number" ||
      !Number.isFinite(item.createdAt)
    )
      throw new Error("Invalid worktree");
    return {
      id: item.id,
      projectId: item.projectId,
      repository: item.repository,
      branch: item.branch,
      path: item.path,
      createdAt: item.createdAt,
    };
  });
}

export function WorktreeSettings({
  request,
}: {
  request: (command: ClientCommand) => Promise<unknown>;
}) {
  const t = useAppText();
  const errorText = useErrorText();
  const [trees, setTrees] = useState<WireWorktree[]>([]);
  const [selected, setSelected] = useState<WireWorktree | null>(null);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [pending, setPending] = useState(true);
  const submitting = useRef(true);
  const cancel = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void request({ type: "worktrees.list" })
      .then((value) => {
        if (alive.current) setTrees(parseWorktrees(value));
      })
      .catch((reason) => {
        if (alive.current) setError(errorText(reason));
      })
      .finally(() => {
        submitting.current = false;
        if (alive.current) setPending(false);
      });
    return () => {
      alive.current = false;
    };
  }, [request]);
  const refresh = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const value = parseWorktrees(await request({ type: "worktrees.refresh" }));
      if (alive.current) setTrees(value);
    } catch (reason) {
      if (alive.current) setError(errorText(reason));
    } finally {
      submitting.current = false;
      if (alive.current) setPending(false);
    }
  };
  const close = () => {
    if (!submitting.current) {
      setSelected(null);
      setDialogError("");
    }
  };
  const remove = async () => {
    if (!selected || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setDialogError("");
    try {
      const value = parseWorktrees(
        await request({ type: "worktree.delete", worktreeId: selected.id }),
      );
      if (alive.current) {
        setTrees(value);
        setSelected(null);
      }
    } catch (reason) {
      if (alive.current)
        setDialogError(
          reason instanceof WireError && reason.code === "session_busy"
            ? t("worktrees.busy")
            : reason instanceof WireError && reason.code === "worktree_failed"
              ? t("worktrees.delete-failed", reason.params)
              : errorText(reason),
        );
    } finally {
      submitting.current = false;
      if (alive.current) setPending(false);
    }
  };
  return (
    <div className="model-services-workspace worktree-settings">
      <header className="worktree-settings-title">
        <h1 className="text-ui-xl font-medium">{t("services.nav.worktrees")}</h1>
      </header>
      <section
        className="worktree-settings-section"
        aria-labelledby="worktrees-heading"
        aria-busy={pending}
      >
        <div className="worktree-settings-heading">
          <div>
            <h2 id="worktrees-heading" className="text-ui-lg font-medium">
              {t("worktrees.heading")}
            </h2>
            <p className="text-ui-base text-muted-foreground">{t("worktrees.description")}</p>
          </div>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => void refresh()}>
            <RefreshCw className="size-4" />
            {t("worktrees.refresh")}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        ) : null}
        {trees.length ? (
          <ul className="worktree-settings-list">
            {trees.map((tree) => (
              <li key={tree.id} className="worktree-settings-row">
                <GitBranch aria-hidden="true" className="size-4 shrink-0" />
                <div className="worktree-settings-info">
                  <div className="worktree-settings-branch">
                    <span className="font-mono text-ui-base">{tree.branch}</span>
                    <span className="worktree-settings-repository text-muted-foreground">
                      {tree.repository.split(/[\\/]/).filter(Boolean).at(-1)}
                    </span>
                  </div>
                  <p className="font-mono text-ui-xs text-muted-foreground">{tree.path}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setDialogError("");
                    setSelected(tree);
                  }}
                >
                  {t("worktrees.delete")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="worktree-settings-empty">
            <GitBranch aria-hidden="true" className="size-8 text-muted-foreground" />
            <p>{t("worktrees.empty")}</p>
          </div>
        )}
      </section>
      {selected ? (
        <MorphingModal
          viewId={selected.id}
          label={t("worktrees.delete-title")}
          placement="center"
          className="worktree-settings-dialog"
          initialFocus={cancel}
          onClose={close}
        >
          <div className="worktree-settings-dialog-content" aria-busy={pending}>
            <h2 className="text-ui-lg font-medium">{t("worktrees.delete-title")}</h2>
            <p className="text-ui-base text-muted-foreground">
              {t("worktrees.delete-description", { path: selected.path, branch: selected.branch })}
            </p>
            {dialogError ? (
              <p role="alert" className="text-ui-sm text-destructive">
                {dialogError}
              </p>
            ) : null}
            <div className="worktree-settings-dialog-footer">
              <Button
                ref={cancel}
                autoFocus
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={close}
              >
                {t("app.cancel")}
              </Button>
              <Button variant="destructive" disabled={pending} onClick={() => void remove()}>
                {t("worktrees.delete")}
              </Button>
            </div>
          </div>
        </MorphingModal>
      ) : null}
    </div>
  );
}
