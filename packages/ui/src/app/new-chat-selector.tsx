import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  GitBranch,
  MessageSquare,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { WireProject, WireProjectGit } from "@rukie/shared";
import { Tooltip } from "../components/motion/tooltip";
import * as Menu from "../components/ui/dropdown-menu";
import { useAppText } from "../lib/i18n";
import "./new-chat-selector.css";

/** project.git replies are untrusted wire values. */
export function parseProjectGit(value: unknown): WireProjectGit {
  if (
    typeof value !== "object" ||
    value === null ||
    !("repository" in value) ||
    typeof value.repository !== "boolean" ||
    !("branch" in value) ||
    (value.branch !== null && typeof value.branch !== "string") ||
    !("head" in value) ||
    typeof value.head !== "string" ||
    !("branches" in value) ||
    !Array.isArray(value.branches) ||
    !value.branches.every((item: unknown) => typeof item === "string")
  )
    throw new Error("Invalid project.git reply");
  return {
    repository: value.repository,
    branch: value.branch,
    head: value.head,
    branches: value.branches as string[],
  };
}

/** Radix menus consume printable keys for typeahead; the search field keeps them. */
function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Escape" && event.key !== "ArrowDown" && event.key !== "Tab")
    event.stopPropagation();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    event.currentTarget
      .closest('[role="menu"]')
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
      ?.focus();
  }
}

function SearchField({
  value,
  onValue,
  placeholder,
  onEnter,
}: {
  value: string;
  onValue: (value: string) => void;
  placeholder: string;
  onEnter?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Radix focuses the menu content after mount; the search field takes focus afterwards.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="new-chat-search">
      <Search aria-hidden="true" className="size-3 shrink-0" />
      <input
        ref={input}
        value={value}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event) => onValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onEnter) {
            event.preventDefault();
            event.stopPropagation();
            onEnter();
            return;
          }
          searchKeys(event);
        }}
      />
    </div>
  );
}

function Mark({ checked }: { checked: boolean }) {
  return (
    <span className="new-chat-mark" aria-hidden="true">
      {checked ? <Check className="size-3" /> : null}
    </span>
  );
}

export interface NewChatSelectorProps {
  projects: WireProject[];
  target: WireProject | undefined;
  git: WireProjectGit | null;
  worktree: boolean;
  disabled: boolean;
  onProject: (projectId: string | null) => void;
  onAddProject: () => void;
  onWorktree: (enabled: boolean) => void;
  /** Resolves to a localized failure, or null after the branch changed. */
  onBranch: (branch: string, create: boolean) => Promise<string | null>;
}

/** C32/C33/C34: shown only before a new Session is created, above and as wide as the composer. */
export function NewChatSelector(props: NewChatSelectorProps) {
  const t = useAppText();
  const [projectQuery, setProjectQuery] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [createHint, setCreateHint] = useState(false);
  // The open menu marks the rest of the page aria-hidden, so failures render inside it.
  const [branchError, setBranchError] = useState("");
  const name = props.target?.name ?? t("app.conversation");
  const projects = props.projects.filter((project) =>
    project.name.toLowerCase().includes(projectQuery.trim().toLowerCase()),
  );
  const git = props.target && props.git?.repository ? props.git : null;
  const source = git ? (git.branch ?? git.head.slice(0, 8)) : "";
  const query = branchQuery.trim();
  const branches = git
    ? git.branches.filter((branch) => branch.toLowerCase().includes(query.toLowerCase()))
    : [];
  const creatable = Boolean(query) && !git?.branches.includes(query);
  const label = props.worktree ? t("app.branch-worktree", { branch: source }) : source;
  const run = async (branch: string, create: boolean) => {
    if (switching) return;
    setSwitching(true);
    setBranchError("");
    try {
      const failure = await props.onBranch(branch, create);
      if (failure) setBranchError(failure);
      else {
        setBranchQuery("");
        setCreateHint(false);
        setBranchOpen(false);
      }
    } finally {
      setSwitching(false);
    }
  };
  const create = () => {
    if (creatable) void run(query, true);
    else setCreateHint(true);
  };
  return (
    <div className="new-chat-selector" data-project={props.target ? "" : undefined}>
      <div className="new-chat-project">
        {props.target ? (
          <button
            type="button"
            className="new-chat-clear"
            aria-label={t("app.clear-project")}
            disabled={props.disabled}
            onClick={() => props.onProject(null)}
          >
            <Folder aria-hidden="true" className="new-chat-folder size-3" />
            <X aria-hidden="true" className="new-chat-x size-3" />
          </button>
        ) : (
          <span className="new-chat-clear" aria-hidden="true">
            <MessageSquare className="size-3" />
          </span>
        )}
        <Menu.DropdownMenu onOpenChange={(open) => open || setProjectQuery("")}>
          <Menu.DropdownMenuTrigger asChild disabled={props.disabled}>
            <button type="button" className="new-chat-trigger">
              <span className="truncate">{name}</span>
              <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
            </button>
          </Menu.DropdownMenuTrigger>
          <Menu.DropdownMenuContent side="top" className="new-chat-menu w-72">
            <SearchField
              value={projectQuery}
              onValue={setProjectQuery}
              placeholder={t("app.search-projects")}
            />
            <div className="new-chat-menu-list">
              {projects.map((project) => (
                <Menu.DropdownMenuItem
                  key={project.id}
                  onSelect={() => props.onProject(project.id)}
                >
                  <Folder className="size-3" />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <Mark checked={project.id === props.target?.id} />
                </Menu.DropdownMenuItem>
              ))}
              {!projects.length ? (
                <p className="new-chat-empty">{t("app.no-projects-found")}</p>
              ) : null}
            </div>
            <Menu.DropdownMenuSeparator />
            <Menu.DropdownMenuItem onSelect={props.onAddProject}>
              <Plus className="size-3" />
              <span className="flex-1">{t("app.add-new-project")}</span>
              <Mark checked={false} />
            </Menu.DropdownMenuItem>
            <Menu.DropdownMenuItem onSelect={() => props.onProject(null)}>
              <FolderOpen className="size-3" />
              <span className="flex-1">{t("app.no-project")}</span>
              <Mark checked={!props.target} />
            </Menu.DropdownMenuItem>
          </Menu.DropdownMenuContent>
        </Menu.DropdownMenu>
      </div>
      {git ? (
        <Menu.DropdownMenu
          open={branchOpen}
          onOpenChange={(open) => {
            setBranchOpen(open);
            if (!open) {
              setBranchQuery("");
              setCreateHint(false);
              setBranchError("");
            }
          }}
        >
          <Tooltip content={label}>
            <Menu.DropdownMenuTrigger asChild disabled={props.disabled}>
              <button
                type="button"
                className="new-chat-trigger new-chat-branch"
                aria-label={t("app.current-branch", { branch: label })}
              >
                <GitBranch aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate font-mono text-ui-caption">{label}</span>
                <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
              </button>
            </Menu.DropdownMenuTrigger>
          </Tooltip>
          <Menu.DropdownMenuContent side="top" align="end" className="new-chat-menu w-80">
            <SearchField
              value={branchQuery}
              onValue={(value) => {
                setBranchQuery(value);
                setCreateHint(false);
              }}
              placeholder={t("app.search-branches")}
              onEnter={() => {
                if (branches.length === 1 && branches[0] === query) void run(query, false);
                else if (creatable && !branches.length) void run(query, true);
              }}
            />
            <Menu.DropdownMenuSeparator />
            <Menu.DropdownMenuLabel className="new-chat-group">
              {t("app.branches")}
            </Menu.DropdownMenuLabel>
            <div className="new-chat-menu-list">
              {branches.map((branch) => (
                <Menu.DropdownMenuItem
                  key={branch}
                  disabled={switching}
                  onSelect={(event) => {
                    event.preventDefault();
                    void run(branch, false);
                  }}
                >
                  <GitBranch className="size-3" />
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-ui-caption"
                    title={branch}
                  >
                    {branch}
                  </span>
                  <Mark checked={branch === git.branch} />
                </Menu.DropdownMenuItem>
              ))}
              {!branches.length ? (
                <p className="new-chat-empty">{t("app.no-branches-found")}</p>
              ) : null}
            </div>
            <Menu.DropdownMenuSeparator />
            <Menu.DropdownMenuItem
              disabled={switching}
              onSelect={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <Plus className="size-3" />
              <span className="min-w-0 flex-1 truncate">
                {creatable
                  ? t("app.create-branch-named", { branch: query })
                  : t("app.create-branch")}
              </span>
              <Mark checked={false} />
            </Menu.DropdownMenuItem>
            {createHint ? (
              <p role="status" className="new-chat-note">
                {t("app.create-branch-hint")}
              </p>
            ) : null}
            {branchError ? (
              <p role="alert" className="new-chat-note new-chat-error">
                {branchError}
              </p>
            ) : null}
            <Menu.DropdownMenuCheckboxItem
              checked={props.worktree}
              disabled={switching}
              onCheckedChange={props.onWorktree}
              onSelect={(event) => event.preventDefault()}
            >
              <GitBranch className="size-3" />
              {t("app.use-worktree")}
            </Menu.DropdownMenuCheckboxItem>
            {props.worktree ? (
              <p className="new-chat-note">{t("app.worktree-hint", { branch: source })}</p>
            ) : null}
          </Menu.DropdownMenuContent>
        </Menu.DropdownMenu>
      ) : null}
    </div>
  );
}
