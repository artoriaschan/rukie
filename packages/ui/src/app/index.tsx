import { OVERLAY_LAYER } from "@/lib/overlay";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  Folder,
  Home,
  ListTree,
  MessageSquare,
  Plus,
  PanelLeft,
  Ellipsis,
  WifiOff,
  LoaderCircle,
  Settings,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import type { Locale } from "@rukie/i18n";
import type {
  PermissionMode,
  WirePreferences,
  WireSessionSummary,
  WireProjectGit,
  WireProject,
  WireSkill,
} from "@rukie/shared";
import { createWireClient, WireError, type ClientCommand } from "../client";
import { createDesktopStore, recentSessions, type SessionViewState } from "../store";
import type { DesktopHost } from "../host";
import { sessionActions, SessionDropdownItems } from "../components/session-actions";
import { Sidebar } from "../components/sidebar";
import { Composer, type PromptImages, type ModelSelection } from "../components/composer";
import { Button } from "../components/motion/button/base";
import { Tooltip } from "../components/motion/tooltip";
import { CommandPalette } from "../components/motion/command-palette";
import * as Menu from "../components/ui/dropdown-menu";
import { UiLocaleProvider, useAppText } from "../lib/i18n";
import { cn } from "../lib/utils";
import type { PermissionDecision } from "../lib/transcript";
import { createAppearance, type Appearance } from "../lib/appearance";
import { ModelServices } from "./model-services";
import { AppConversation } from "./conversation";
import { ProjectCreate } from "./project-create";
import { directoryName, removeProjectDirectory } from "./project-directories";
import { ProjectEdit } from "./project-edit";
import { ProjectTrust } from "./project-trust";
import { DeleteSession } from "./delete-session";
import { RenameProject, RenameSession } from "./rename-session";
import { ProjectRemove } from "./project-remove";
import { useErrorText } from "./error";
import { GoalStatus } from "../components/goal-status";
import { readGoal } from "../lib/goal";
import { GoalConfirmation } from "./goal-confirmation";
import { NewChatSelector, parseProjectGit } from "./new-chat-selector";

export type AppHost = Pick<DesktopHost, "getConnection" | "modelServices"> &
  Partial<Omit<DesktopHost, "getConnection" | "modelServices">>;
export interface ConversationProps {
  footer: (approval?: ReactNode, interaction?: boolean) => ReactNode;
  sessionId: string;
  view: SessionViewState;
  connected: boolean;
  summaryOpen: boolean;
  onCloseSummary: () => void;
  request: (command: ClientCommand) => Promise<unknown>;
  draft: string;
  onDraft: (text: SetStateAction<string>) => void;
  images: PromptImages;
  onImages: (images: SetStateAction<PromptImages>) => void;
  onInteractionResolved: (epoch: string, decision?: PermissionDecision) => void;
}
export interface AppProps {
  host: AppHost;
  locale?: Locale;
  appearance?: Appearance;
  Conversation?: ComponentType<ConversationProps>;
}
const emptyView: SessionViewState = { interactions: {}, busy: false };
interface NavigationEntry {
  settings: boolean;
  session: string | null;
  target: string | null;
  draft: string;
}
interface InputDraft {
  text: string;
  images: PromptImages;
  textRevision: number;
  imageRevision: number;
  goalEnabled: boolean;
  goalRevision: number;
  permissionMode: PermissionMode;
}
const emptyDraft: InputDraft = {
  text: "",
  images: [],
  textRevision: 0,
  imageRevision: 0,
  goalEnabled: false,
  goalRevision: 0,
  permissionMode: "ask",
};
export function App({ locale = "en", ...props }: AppProps) {
  return (
    <UiLocaleProvider locale={locale}>
      <DesktopApp {...props} />
    </UiLocaleProvider>
  );
}
function DesktopApp({
  host,
  appearance,
  Conversation = AppConversation,
}: Omit<AppProps, "locale">) {
  const localAppearance = useRef<Appearance | undefined>(undefined);
  const getAppearance = () =>
    appearance ??
    (localAppearance.current ??= createAppearance(
      host.setThemeSource ? { setThemeSource: host.setThemeSource } : undefined,
    ));
  useEffect(() => () => localAppearance.current?.dispose(), []);
  const t = useAppText();
  const errorText = useErrorText();
  const [store] = useState(createDesktopStore);
  const [client] = useState(() => {
    const value = createWireClient(host);
    host.bindClient?.(value);
    return value;
  });
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!settingsOpen) settingsOpener.current?.focus();
  }, [settingsOpen]);
  const [sidebar, setSidebar] = useState(() => matchMedia("(min-width: 768px)").matches);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState(false);
  const [summary, setSummary] = useState(false);
  const [deleting, setDeleting] = useState<WireSessionSummary | null>(null);
  const [renaming, setRenaming] = useState<WireSessionSummary | null>(null);
  const [pathOpen, setPathOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectError, setProjectError] = useState("");
  const [pickingFolder, setPickingFolder] = useState(false);
  const [directories, setDirectories] = useState<string[]>([]);
  const [primary, setPrimary] = useState("");
  const [detailEpoch, setDetailEpoch] = useState(0);
  const [detailProject, setDetailProject] = useState<{ id: string; pinned: boolean } | null>(null);
  const [editingProject, setEditingProject] = useState<WireProject | null>(null);
  const [renamingProject, setRenamingProject] = useState<WireProject | null>(null);
  const [removingProject, setRemovingProject] = useState<WireProject | null>(null);
  const [trust, setTrust] = useState<{
    project: Pick<WireProject, "directories" | "primary">;
    creating: boolean;
    confirm: () => Promise<unknown>;
    cancel: () => void;
  } | null>(null);
  const declinedTrust = useRef(new Set<string>());
  const ensureTrust = (project: WireProject | undefined, reuseDecline = false): Promise<void> => {
    if (!project || project.trusted || (reuseDecline && declinedTrust.current.has(project.id)))
      return Promise.resolve();
    return new Promise((resolve) =>
      setTrust({
        project,
        creating: false,
        confirm: async () => {
          await client.request({ type: "project.trust", projectId: project.id });
          setTrust(null);
          resolve();
        },
        cancel: () => {
          declinedTrust.current.add(project.id);
          setTrust(null);
          resolve();
        },
      }),
    );
  };
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, InputDraft>>({});
  const newDraftSequence = useRef(0);
  const [newDraftKey, setNewDraftKey] = useState("new-0");
  const detailsDisabled =
    settingsOpen ||
    search ||
    !!deleting ||
    !!renaming ||
    pathOpen ||
    !!editingProject ||
    !!renamingProject ||
    !!removingProject ||
    !!trust;
  useEffect(() => {
    setDetailProject(null);
    // Invalidate pending hover intent even when no card has opened yet.
    setDetailEpoch((previous) => previous + 1);
  }, [detailsDisabled, state.selected, state.target, newDraftKey]);
  useEffect(() => {
    setDetailProject((previous) =>
      previous && !state.projects.some((project) => project.id === previous.id) ? null : previous,
    );
  }, [state.projects]);
  const [navigation, setNavigation] = useState<{ entries: NavigationEntry[]; index: number }>({
    entries: [{ settings: false, session: null, target: null, draft: "new-0" }],
    index: 0,
  });
  const restoringNavigation = useRef(false);
  useEffect(() => {
    if (restoringNavigation.current) {
      restoringNavigation.current = false;
      return;
    }
    const entry = {
      settings: settingsOpen,
      session: state.selected,
      target: state.target,
      draft: newDraftKey,
    };
    setNavigation((previous) => {
      const current = previous.entries[previous.index]!;
      if (
        current.settings === entry.settings &&
        current.session === entry.session &&
        current.target === entry.target &&
        current.draft === entry.draft
      )
        return previous;
      const entries = [...previous.entries.slice(0, previous.index + 1), entry];
      return { entries, index: entries.length - 1 };
    });
  }, [settingsOpen, state.selected, state.target, newDraftKey]);
  const draftKey = state.selected ?? newDraftKey;
  const inputDraft = drafts[draftKey] ?? emptyDraft;
  const draft = inputDraft.text;
  const images = inputDraft.images;
  // Each callback owns its originating Session or new-chat draft across async responses.
  const setDraft = (next: SetStateAction<string>) =>
    setDrafts((previous) => {
      const current = previous[draftKey] ?? emptyDraft;
      return {
        ...previous,
        [draftKey]: {
          ...current,
          text: typeof next === "function" ? next(current.text) : next,
          textRevision: current.textRevision + 1,
        },
      };
    });
  const setImages = (next: SetStateAction<PromptImages>) =>
    setDrafts((previous) => {
      const current = previous[draftKey] ?? emptyDraft;
      return {
        ...previous,
        [draftKey]: {
          ...current,
          images: typeof next === "function" ? next(current.images) : next,
          imageRevision: current.imageRevision + 1,
        },
      };
    });
  const permission = inputDraft.permissionMode;
  const setPermission = (permissionMode: PermissionMode) =>
    setDrafts((previous) => ({
      ...previous,
      [draftKey]: { ...(previous[draftKey] ?? emptyDraft), permissionMode },
    }));
  const [goalConfirmation, setGoalConfirmation] = useState<{
    key: string;
    sessionId: string | null;
  } | null>(null);
  const [goalRemoval, setGoalRemoval] = useState<{ sessionId: string; goalId: string } | null>(
    null,
  );
  const goalRemovalFocus = useRef<typeof goalRemoval>(null);
  const goalRemovalOwner = useRef(goalRemoval);
  const changeGoalRemoval = (next: typeof goalRemoval) => {
    goalRemovalOwner.current = next;
    goalRemovalFocus.current = null;
    setGoalRemoval(next);
  };
  const finishGoalRemoval = (origin: NonNullable<typeof goalRemoval>) => {
    if (goalRemovalOwner.current !== origin) return;
    goalRemovalOwner.current = null;
    setGoalRemoval(null);
  };
  const goalConfirmationOwner = useRef(goalConfirmation);
  const changeGoalConfirmation = (next: typeof goalConfirmation) => {
    goalConfirmationOwner.current = next;
    setGoalConfirmation(next);
  };
  const setGoalEnabled = (key: string, enabled: boolean) =>
    setDrafts((previous) => {
      const current = previous[key] ?? emptyDraft;
      return {
        ...previous,
        [key]: { ...current, goalEnabled: enabled, goalRevision: current.goalRevision + 1 },
      };
    });
  useEffect(() => {
    if (inputDraft.goalEnabled && !goalConfirmation)
      document
        .querySelector<HTMLElement>(".conversation-composer [data-prompt-editor]")
        ?.focus({ preventScroll: true });
  }, [inputDraft.goalEnabled, goalConfirmation]);
  const focusPrompt = () =>
    document
      .querySelector<HTMLElement>(".conversation-composer [data-prompt-editor]")
      ?.focus({ preventScroll: true });

  const [newPlanMode, setNewPlanMode] = useState(false);
  const [model, setModel] = useState<ModelSelection>();
  const catalogDefault = state.models.find((item) => item.authenticated);
  const newSessionModel =
    model ??
    (catalogDefault
      ? { provider: catalogDefault.providerId, modelId: catalogDefault.id }
      : undefined);
  const [sending, setSending] = useState(false);
  const pathOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // Modal cleanup runs before this effect. Restoring inside closePath would
    // still be intercepted by the folder dialog's focus trap.
    if (!pathOpen && !trust) pathOpener.current?.focus();
  }, [pathOpen, trust]);
  const recent = useMemo(
    () => recentSessions(state).filter((session) => !state.archived.includes(session.id)),
    [state.sessions, state.preferences, state.archived],
  );
  const current = state.sessions.find((session) => session.id === state.selected);
  const searchSessions = useMemo(
    () =>
      state.sessions
        .filter((session) => !state.archived.includes(session.id))
        .toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
    [state.sessions, state.archived],
  );
  const view = state.selected ? (state.views[state.selected] ?? emptyView) : emptyView;
  const goal = readGoal(view.transcript?.toolStates.goal);
  const unfinishedGoal = goal && goal.phase !== "complete" ? goal : undefined;
  const hasGoal = Boolean(unfinishedGoal);
  useEffect(() => {
    if (
      goalRemovalFocus.current !== null &&
      goalRemovalFocus.current.sessionId === state.selected &&
      !unfinishedGoal &&
      !goalRemoval
    ) {
      goalRemovalFocus.current = null;
      focusPrompt();
    } else if (
      goalRemovalFocus.current &&
      (goalRemovalFocus.current.sessionId !== state.selected ||
        (unfinishedGoal && goalRemovalFocus.current.goalId !== unfinishedGoal.id))
    )
      goalRemovalFocus.current = null;
  }, [state.selected, unfinishedGoal, goalRemoval]);
  useEffect(() => {
    if (
      goalRemoval &&
      (goalRemoval.sessionId !== state.selected || goalRemoval.goalId !== unfinishedGoal?.id)
    ) {
      if (goalRemoval.sessionId === state.selected && !unfinishedGoal)
        finishGoalRemoval(goalRemoval);
      else changeGoalRemoval(null);
    }
  }, [goalRemoval, state.selected, unfinishedGoal?.id]);
  const goalEnabled = inputDraft.goalEnabled && !hasGoal;
  useEffect(() => {
    if (!hasGoal || !inputDraft.goalEnabled) return;
    // A published Goal consumes any pending local intent, including creation in another window.
    setDrafts((previous) => {
      const current = previous[draftKey] ?? emptyDraft;
      if (!current.goalEnabled) return previous;
      return {
        ...previous,
        [draftKey]: { ...current, goalEnabled: false, goalRevision: current.goalRevision + 1 },
      };
    });
  }, [draftKey, hasGoal, inputDraft.goalEnabled]);
  const goalDisabledReason =
    view.running || current?.running
      ? t("app.goal-mode-running")
      : unfinishedGoal
        ? t("app.goal-mode-existing")
        : undefined;
  const targetProject = state.projects.find((project) => project.id === state.target);
  const [projectGit, setProjectGit] = useState<WireProjectGit | null>(null);
  const [useWorktree, setUseWorktree] = useState(false);
  useEffect(() => {
    let active = true;
    setProjectGit(null);
    setUseWorktree(false);
    if (!state.selected && targetProject && state.connection === "connected") {
      void client
        .request({ type: "project.git", projectId: targetProject.id })
        .then((result) => {
          if (active) setProjectGit(parseProjectGit(result));
        })
        .catch(() => {
          if (active) setProjectGit(null);
        });
    }
    return () => {
      active = false;
    };
  }, [
    client,
    state.connection,
    state.selected,
    targetProject?.id,
    targetProject?.primary,
    newDraftKey,
  ]);
  /** Returns the localized failure so the open branch menu can present it. */
  const changeBranch = async (branch: string, create: boolean) => {
    if (!targetProject) return errorText(new WireError("project_not_found"));
    try {
      setProjectGit(
        parseProjectGit(
          await client.request({
            type: create ? "project.createBranch" : "project.checkout",
            projectId: targetProject.id,
            branch,
          }),
        ),
      );
      return null;
    } catch (reason) {
      return errorText(reason);
    }
  };
  const currentProject = state.projects.find((project) => project.id === current?.projectId);
  const connected = state.connection === "connected";
  /** A Project with live Session work cannot be removed until that work settles. */
  const projectBusy = (projectId: string) =>
    state.sessions.some(
      (session) =>
        projectId === session.projectId &&
        (session.running ||
          session.waitingInteraction ||
          state.views[session.id]?.running ||
          state.views[session.id]?.busy ||
          Object.keys(state.views[session.id]?.interactions ?? {}).length > 0),
    );
  const safe = (action: () => Promise<unknown>) => {
    void action().catch((reason) => setError(t("app.error", { message: errorText(reason) })));
  };
  const select = async (sessionId: string, reuseDecline = false) => {
    await ensureTrust(
      store
        .getState()
        .projects.find(
          (project) =>
            project.id ===
            store.getState().sessions.find((session) => session.id === sessionId)?.projectId,
        ),
      reuseDecline,
    );
    const previous = store.getState().selected;
    store.select(sessionId);
    setError("");
    setSummary(false);
    if (!matchMedia("(min-width: 768px)").matches) setSidebar(false);
    if (previous && previous !== sessionId) await client.unsubscribe(previous);
    try {
      await client.subscribe(sessionId);
      store.setBusy(sessionId, false);
    } catch (reason) {
      if (reason instanceof WireError && reason.code === "session_busy")
        store.setBusy(sessionId, true);
      else throw reason;
    }
  };
  const enterNewChat = (project: string | null) => {
    const previous = store.getState().selected;
    if (previous) safe(() => client.unsubscribe(previous));
    store.select(null, project);
    newDraftSequence.current++;
    setNewDraftKey(`new-${newDraftSequence.current}`);
    setError("");
    setSummary(false);
    if (!matchMedia("(min-width: 768px)").matches) setSidebar(false);
  };
  const newChat = (project: string | null) => {
    safe(async () => {
      await ensureTrust(store.getState().projects.find((p) => p.id === project));
      enterNewChat(project);
    });
  };
  const navigate = (offset: number) => {
    const index = navigation.index + offset;
    const entry = navigation.entries[index];
    if (!entry) return;
    if (
      entry.session &&
      (!state.sessions.some((session) => session.id === entry.session) ||
        state.archived.includes(entry.session))
    ) {
      setError(t("app.error", { message: errorText(new WireError("session_not_found")) }));
      return;
    }
    restoringNavigation.current = true;
    setNavigation({ ...navigation, index });
    setSettingsOpen(entry.settings);
    setNewDraftKey(entry.draft);
    if (entry.session) safe(() => select(entry.session!));
    else {
      const previous = store.getState().selected;
      if (previous) safe(() => client.unsubscribe(previous));
      store.select(null, entry.target);
      setSummary(false);
    }
  };
  const pin = (id: string, pinned: boolean) =>
    safe(() => client.request({ type: pinned ? "session.pin" : "session.unpin", sessionId: id }));
  const archive = (sessionId: string) =>
    safe(() => client.request({ type: "session.archive", sessionId }));
  const move = (session: WireSessionSummary, project: WireProject | null) => {
    const perform = async () => {
      await client.request({
        type: "session.move",
        sessionId: session.id,
        projectId: project?.id ?? null,
      });
      if (store.getState().selected === session.id) await client.subscribe(session.id);
    };
    if (!project || project.trusted) safe(perform);
    else
      setTrust({
        project,
        creating: false,
        confirm: async () => {
          await client.request({ type: "project.trust", projectId: project.id });
          await perform();
          setTrust(null);
        },
        cancel: () => setTrust(null),
      });
  };
  const chooseMoveFolder = (session: WireSessionSummary) => {
    safe(async () => {
      if (!host.pickProjectFolder) throw new WireError("unsupported");
      const selected = await host.pickProjectFolder(false);
      const directory = selected?.[0];
      if (!directory) return;
      setTrust({
        project: { directories: [directory], primary: directory },
        creating: true,
        cancel: () => setTrust(null),
        confirm: async () => {
          const result = await client.request({
            type: "project.create",
            name: directoryName(directory),
            directories: [directory],
            trusted: true,
          });
          if (
            typeof result !== "object" ||
            result === null ||
            !("id" in result) ||
            typeof result.id !== "string"
          )
            throw new WireError("invalid_command");
          await client.request({
            type: "session.move",
            sessionId: session.id,
            projectId: result.id,
          });
          if (store.getState().selected === session.id) await client.subscribe(session.id);
          setTrust(null);
        },
      });
    });
  };
  const preferences = (preferences: WirePreferences) =>
    safe(() => client.request({ type: "preferences.set", preferences }));
  const openSearch = () => {
    setSearch(true);
  };
  const changeSearch = (open: boolean) => {
    setSearch(open);
  };
  useEffect(() => {
    const offMessages = client.subscribeMessages((message) => {
      store.receive(message);
      const latest = store.getState();
      if (
        latest.selected &&
        (latest.archived.includes(latest.selected) ||
          !latest.sessions.some((session) => session.id === latest.selected))
      )
        newChat(null);
    });
    const offSubscriptions = client.subscribeSubscriptions(store.setBusy);
    const offState = client.subscribeState(() => {
      store.setState({
        connection: client.getState(),
        ...(client.getState() === "connected"
          ? {
              views: Object.fromEntries(
                Object.entries(store.getState().views).map(([id, view]) => [
                  id,
                  { ...view, interactions: {} },
                ]),
              ),
            }
          : {}),
      });
      if (client.getState() === "connected")
        safe(async () => {
          const models = await client.request({ type: "models.list" });
          store.setModels(models);
        });
    });
    const hostChange = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        (event.detail === "connected" ||
          event.detail === "reconnecting" ||
          event.detail === "disconnected")
      )
        client.hostState(event.detail);
    };
    window.addEventListener("rukie:connection-change", hostChange);
    void client.connect().catch(() => {});
    return () => {
      offMessages();
      offSubscriptions();
      offState();
      window.removeEventListener("rukie:connection-change", hostChange);
      client.close();
    };
  }, [client, store]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (settingsOpen) return;
      if (
        Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(
          (element) => !element.closest("[inert]"),
        )
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newChat(null);
      }
      if (event.ctrlKey && !event.metaKey && /^[1-9]$/.test(event.key)) {
        const session = recent[Number(event.key) - 1];
        if (session) {
          event.preventDefault();
          safe(() => select(session.id));
        }
      }
      if (event.altKey && event.metaKey && event.key.toLowerCase() === "p" && state.selected) {
        event.preventDefault();
        pin(state.selected, !state.pinned.includes(state.selected));
      }
      if (event.key === "Escape" && summary) setSummary(false);
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
    };
  }, [recent, state.selected, state.pinned, summary, settingsOpen]);
  const send = async () => {
    if (!connected || sending || (!draft.trim() && !(goalEnabled && images.length))) return;
    setSending(true);
    setError("");
    const text = draft.trim();
    const attachments = images;
    try {
      await ensureTrust(state.selected ? currentProject : targetProject, true);
      let createdSessionId: string | undefined;
      if (state.selected)
        await client.request({
          type: goalEnabled ? "session.goal_create" : "prompt",
          sessionId: state.selected,
          text,
          images: attachments,
        });
      else {
        const result = await client.request({
          type: "session.create",
          project: state.target,
          text,
          images: attachments,
          modelSelection: newSessionModel,
          permissionMode: permission,
          ...(goalEnabled ? { goal: true } : {}),
          planMode: newPlanMode,
          ...(projectGit?.repository && useWorktree ? { worktree: true } : {}),
        });
        if (
          typeof result === "object" &&
          result !== null &&
          "sessionId" in result &&
          typeof result.sessionId === "string"
        )
          createdSessionId = result.sessionId;
        else throw new WireError("invalid_command");
      }
      const targetKey = createdSessionId ?? draftKey;
      setDrafts((previous) => {
        const current = previous[draftKey] ?? emptyDraft;
        const next = {
          ...current,
          text: current.textRevision === inputDraft.textRevision ? "" : current.text,
          images: current.imageRevision === inputDraft.imageRevision ? [] : current.images,
          goalEnabled:
            current.goalRevision === inputDraft.goalRevision ? false : current.goalEnabled,
        };
        const updated = { ...previous, [targetKey]: next };
        if (createdSessionId) delete updated[draftKey];
        return updated;
      });
      if (
        createdSessionId &&
        store.getState().selected === null &&
        draftKey === `new-${newDraftSequence.current}`
      )
        await select(createdSessionId, true);
    } finally {
      setSending(false);
    }
  };
  const stop = async () => {
    if (!state.selected) return;
    const result = await client.request({ type: "abort", sessionId: state.selected });
    if (
      typeof result === "object" &&
      result !== null &&
      "inputs" in result &&
      Array.isArray(result.inputs)
    ) {
      const inputs = result.inputs.filter(
        (input): input is { prompt: string; images?: PromptImages } =>
          typeof input === "object" &&
          input !== null &&
          "prompt" in input &&
          typeof input.prompt === "string" &&
          (!("images" in input) ||
            (Array.isArray(input.images) &&
              input.images.every(
                (image: unknown) =>
                  typeof image === "object" &&
                  image !== null &&
                  "data" in image &&
                  typeof image.data === "string" &&
                  "mimeType" in image &&
                  typeof image.mimeType === "string" &&
                  (!("name" in image) ||
                    image.name === undefined ||
                    typeof image.name === "string"),
              ))),
      );
      setDraft((previous) =>
        [...inputs.map((input) => input.prompt), previous].filter(Boolean).join("\n\n"),
      );
      setImages((previous) => [...inputs.flatMap((input) => input.images ?? []), ...previous]);
    }
  };
  const setMode = (mode: PermissionMode) => {
    if (state.selected)
      safe(async () => {
        await client.request({
          type: "session.set_permission_mode",
          sessionId: state.selected!,
          mode,
        });
        setPermission(mode);
      });
    else setPermission(mode);
  };
  const setPlanMode = (on: boolean) => {
    if (state.selected)
      safe(async () => {
        await client.request({ type: "session.set_plan_mode", sessionId: state.selected!, on });
      });
    else setNewPlanMode(on);
  };
  const setSelection = (selection: ModelSelection) => {
    if (state.selected)
      safe(async () => {
        await client.request({
          type: "session.set_model",
          sessionId: state.selected!,
          ...selection,
        });
        setModel(selection);
      });
    else setModel(selection);
  };
  const addProject = async () => {
    pathOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setProjectName("");
    setDirectories([]);
    setPrimary("");
    setProjectError("");
    setPathOpen(true);
  };
  const pickFolder = async () => {
    if (pickingFolder) return;
    setPickingFolder(true);
    setProjectError("");
    try {
      if (!host.pickProjectFolder) throw new WireError("unsupported");
      const selected = await host.pickProjectFolder();
      if (!selected?.length) return;
      const existing =
        !directories.length && state.projects.find((project) => project.primary === selected[0]);
      if (existing) {
        setPathOpen(false);
        await ensureTrust(existing);
        enterNewChat(existing.id);
        return;
      }
      if (!directories.length)
        setProjectName((previous) => (previous.trim() ? previous : directoryName(selected[0]!)));
      setDirectories((previous) => [...new Set([...previous, ...selected])]);
      setPrimary((previous) => previous || selected[0] || "");
    } catch (reason) {
      setProjectError(errorText(reason));
    } finally {
      setPickingFolder(false);
    }
  };
  const closePath = () => {
    setPathOpen(false);
    setProjectName("");
    setProjectError("");
  };
  const removeDirectory = (directory: string) => {
    const next = removeProjectDirectory(directories, primary, directory);
    setDirectories(next.directories);
    setPrimary(next.primary);
  };
  const confirmProject = () => {
    if (!projectName.trim() || !directories.length || !primary || pickingFolder || !connected)
      return;
    const existing = state.projects.find((project) => project.primary === primary);
    if (existing) {
      closePath();
      safe(async () => {
        await ensureTrust(existing);
        enterNewChat(existing.id);
      });
      return;
    }
    const ordered = [primary, ...directories.filter((directory) => directory !== primary)];
    setProjectError("");
    setTrust({
      project: { directories: ordered, primary },
      creating: true,
      cancel: () => {
        setTrust(null);
        setPathOpen(true);
      },
      confirm: async () => {
        try {
          const result = await client.request({
            type: "project.create",
            name: projectName.trim(),
            directories: ordered,
            trusted: true,
          });
          if (
            typeof result !== "object" ||
            result === null ||
            !("id" in result) ||
            typeof result.id !== "string"
          )
            throw new WireError("invalid_command");
          setTrust(null);
          closePath();
          enterNewChat(result.id);
        } catch (reason) {
          setProjectError(errorText(reason));
          setTrust(null);
          setPathOpen(true);
        }
      },
    });
    setPathOpen(false);
  };
  const markdown = () =>
    view.transcript?.committed
      .map((message) => {
        if (typeof message !== "object" || message === null || !("content" in message)) return "";
        const content = message.content;
        return typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .flatMap((block) =>
                  typeof block === "object" &&
                  block !== null &&
                  block.type === "text" &&
                  typeof block.text === "string"
                    ? [block.text]
                    : [],
                )
                .join("\n")
            : "";
      })
      .join("\n\n") ?? "";
  const toggleGoal = () => {
    if (inputDraft.goalEnabled) {
      setGoalEnabled(draftKey, false);
      return;
    }
    if ((view.permissionMode ?? permission) !== "full-access")
      changeGoalConfirmation({ key: draftKey, sessionId: state.selected });
    else {
      setGoalEnabled(draftKey, true);
      focusPrompt();
    }
  };
  const skillErrorText = useRef(errorText);
  skillErrorText.current = errorText;
  const skillRefreshEpochs = useRef(new Map<string, number>());
  const skillScope = state.selected ? `session:${state.selected}` : `project:${state.target ?? ""}`;
  const [skillCatalogs, setSkillCatalogs] = useState<Record<string, WireSkill[]>>({});
  const refreshSkills = useCallback(() => {
    const epoch = (skillRefreshEpochs.current.get(skillScope) ?? 0) + 1;
    skillRefreshEpochs.current.set(skillScope, epoch);
    const command: ClientCommand = state.selected
      ? { type: "skills.list", sessionId: state.selected }
      : { type: "skills.list", ...(state.target ? { projectId: state.target } : {}) };
    void client
      .request(command)
      .then((result) => {
        if (skillRefreshEpochs.current.get(skillScope) !== epoch || !Array.isArray(result)) return;
        const skills = result.filter((item: unknown): item is WireSkill =>
          Boolean(
            item &&
            typeof item === "object" &&
            "name" in item &&
            typeof item.name === "string" &&
            "description" in item &&
            typeof item.description === "string" &&
            "filePath" in item &&
            typeof item.filePath === "string" &&
            "scope" in item &&
            (item.scope === "user" || item.scope === "project"),
          ),
        );
        setSkillCatalogs((previous) => ({ ...previous, [skillScope]: skills }));
      })
      .catch((cause: unknown) => setError(skillErrorText.current(cause)));
  }, [client, state.selected, state.target, skillScope]);
  useEffect(() => {
    if (connected) refreshSkills();
  }, [connected, refreshSkills]);
  const composer = (
    <Composer
      skills={skillCatalogs[skillScope] ?? []}
      onSkillsOpen={refreshSkills}
      draft={draft}
      images={images}
      onDraft={setDraft}
      onImages={setImages}
      disabled={!connected}
      submitting={sending}
      running={Boolean(view.running)}
      planMode={state.selected ? (view.planMode ?? false) : newPlanMode}
      onPlanMode={setPlanMode}
      permissionMode={view.permissionMode ?? permission}
      onPermission={setMode}
      goalEnabled={goalEnabled}
      goalDisabledReason={goalDisabledReason}
      onGoal={toggleGoal}
      placeholder={
        goalEnabled
          ? t("app.goal-placeholder")
          : unfinishedGoal
            ? t(
                view.running && unfinishedGoal.armed
                  ? "app.goal-steer-placeholder"
                  : "app.goal-paused-placeholder",
              )
            : undefined
      }
      models={state.models}
      model={
        state.selected
          ? view.snapshot?.model
          : newSessionModel
            ? `${newSessionModel.provider}/${newSessionModel.modelId}`
            : undefined
      }
      thinkingLevel={view.thinkingLevel ?? model?.thinkingLevel}
      contextReport={view.contextReport}
      openingContext={view.openingContext}
      compactionPoints={view.snapshot?.compactions.length}
      onModel={setSelection}
      onSend={() => safe(send)}
      onStop={() => safe(stop)}
    />
  );
  const footer = (approval?: ReactNode, interaction = false) => (
    <div
      className={cn(
        "mx-auto flex w-full min-w-0 flex-col gap-2 px-3 pb-4 sm:px-6",
        approval && !interaction ? "max-w-3xl" : "max-w-composer-frame",
      )}
    >
      {!connected ? (
        <div role="status" className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            {state.connection === "reconnecting" ? (
              <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
            ) : (
              <WifiOff className="size-3" />
            )}
            <span>
              {t(state.connection === "reconnecting" ? "app.reconnecting" : "app.disconnected")}
            </span>
            {state.connection === "disconnected" ? (
              <Button
                size="contextual"
                variant="secondary"
                onClick={() => safe(() => client.connect())}
              >
                {t("app.retry")}
              </Button>
            ) : null}
          </div>
          <p className="mt-1 text-ui-sm text-muted-foreground">{t("app.connection-explanation")}</p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-ui-sm text-danger">
          {error}
        </p>
      ) : null}
      {approval ??
        (view.busy ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3"
          >
            <p>{t("app.busy")}</p>
            <Button
              size="contextual"
              variant="secondary"
              disabled={!connected}
              onClick={() => state.selected && safe(() => select(state.selected!))}
            >
              {t("app.retry")}
            </Button>
          </div>
        ) : state.selected ? (
          <div className="flex min-w-0 flex-col">
            {unfinishedGoal ? (
              <GoalStatus
                key={`${state.selected}:${unfinishedGoal.id}`}
                goal={unfinishedGoal}
                disabled={!connected}
                onAction={async (action) => {
                  if (action === "clear") {
                    changeGoalRemoval({ sessionId: state.selected!, goalId: unfinishedGoal.id });
                    return;
                  }
                  try {
                    await client.request({
                      type:
                        action === "pause"
                          ? "session.goal_pause"
                          : action === "resume"
                            ? "session.goal_resume"
                            : "session.goal_clear",
                      sessionId: state.selected!,
                    });
                  } catch (reason) {
                    setError(t("app.error", { message: errorText(reason) }));
                  }
                }}
              />
            ) : null}
            <div className="new-chat-composer">{composer}</div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col">
            <NewChatSelector
              projects={state.projects}
              target={targetProject}
              git={projectGit}
              worktree={useWorktree}
              disabled={!connected || sending}
              onProject={(projectId) =>
                projectId === null ? store.select(null, null) : newChat(projectId)
              }
              onAddProject={() => safe(addProject)}
              onWorktree={setUseWorktree}
              onBranch={changeBranch}
            />
            <div className="new-chat-composer">{composer}</div>
          </div>
        ))}
    </div>
  );

  return (
    <div data-workspace-shell className="flex h-dvh min-h-0 flex-col text-ui-base text-foreground">
      <header className="app-titlebar flex h-11 shrink-0 select-none items-center [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
        <div
          className="app-titlebar-navigation relative flex h-full shrink-0 items-center"
          data-sidebar-open={!settingsOpen && sidebar}
        >
          <span aria-hidden="true" />
          <Tooltip content={t("app.back")}>
            <Button
              focus="inset"
              size="icon"
              variant="ghost"
              aria-label={t("app.back")}
              disabled={navigation.index === 0}
              onClick={() => navigate(-1)}
            >
              <ArrowLeft />
            </Button>
          </Tooltip>
          <Tooltip content={t("app.forward")}>
            <Button
              focus="inset"
              size="icon"
              variant="ghost"
              aria-label={t("app.forward")}
              disabled={navigation.index === navigation.entries.length - 1}
              onClick={() => navigate(1)}
            >
              <ArrowRight />
            </Button>
          </Tooltip>
          {!settingsOpen ? (
            <Tooltip content={t("app.toggle-sidebar")}>
              <Button
                focus="inset"
                size="icon"
                variant="ghost"
                ref={sidebarToggle}
                aria-label={t("app.toggle-sidebar")}
                aria-pressed={sidebar}
                onClick={() => setSidebar(!sidebar)}
              >
                <PanelLeft />
              </Button>
            </Tooltip>
          ) : null}
        </div>
        <div
          className={cn(
            "app-titlebar-content flex h-full min-w-0 flex-1 items-center gap-2 px-3",
            !settingsOpen && sidebar && "md:border-l md:border-border",
          )}
        >
          {!settingsOpen && current ? (
            <>
              <Tooltip content={currentProject?.name ?? t("app.conversations")}>
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={currentProject?.name ?? t("app.conversations")}
                  className="rounded-md p-1 text-muted-foreground outline-none [-webkit-app-region:no-drag] focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {currentProject ? (
                    <Folder className="size-3" />
                  ) : (
                    <MessageSquare className="size-3" />
                  )}
                </span>
              </Tooltip>
              <h1 className="min-w-0 flex-1 truncate text-ui-base font-medium">{current.title}</h1>
              <Menu.DropdownMenu>
                <Tooltip content={t("app.more")}>
                  <Menu.DropdownMenuTrigger asChild>
                    <Button focus="inset" size="icon" variant="ghost" aria-label={t("app.more")}>
                      <Ellipsis />
                    </Button>
                  </Menu.DropdownMenuTrigger>
                </Tooltip>
                <Menu.DropdownMenuContent align="end">
                  <Menu.DropdownMenuGroup>
                    <SessionDropdownItems
                      actions={sessionActions(
                        current,
                        state.pinned.includes(current.id),
                        pin,
                        setRenaming,
                        archive,
                        setDeleting,
                        state.projects,
                        move,
                        chooseMoveFolder,
                      )}
                    />
                    <Menu.DropdownMenuSub>
                      <Menu.DropdownMenuSubTrigger size="session">
                        {t("app.copy")}
                      </Menu.DropdownMenuSubTrigger>
                      <Menu.DropdownMenuSubContent>
                        <Menu.DropdownMenuItem
                          size="session"
                          onSelect={() => safe(() => navigator.clipboard.writeText(current.id))}
                        >
                          {t("app.copy-id")}
                        </Menu.DropdownMenuItem>
                        <Menu.DropdownMenuItem
                          size="session"
                          onSelect={() => safe(() => navigator.clipboard.writeText(current.cwd))}
                        >
                          {t("app.copy-cwd")}
                        </Menu.DropdownMenuItem>
                        <Menu.DropdownMenuItem
                          size="session"
                          onSelect={() => safe(() => navigator.clipboard.writeText(markdown()))}
                        >
                          {t("app.copy-markdown")}
                        </Menu.DropdownMenuItem>
                      </Menu.DropdownMenuSubContent>
                    </Menu.DropdownMenuSub>
                    <Menu.DropdownMenuSub>
                      <Menu.DropdownMenuSubTrigger size="session">
                        {t("app.open")}
                      </Menu.DropdownMenuSubTrigger>
                      <Menu.DropdownMenuSubContent>
                        <Menu.DropdownMenuItem
                          size="session"
                          onSelect={() =>
                            safe(() =>
                              client.request({ type: "host.revealPath", path: current.cwd }),
                            )
                          }
                        >
                          {t("app.finder")}
                        </Menu.DropdownMenuItem>
                        <Menu.DropdownMenuItem
                          size="session"
                          onSelect={() =>
                            safe(() =>
                              client.request({ type: "host.openInTerminal", path: current.cwd }),
                            )
                          }
                        >
                          {t("app.terminal")}
                        </Menu.DropdownMenuItem>
                      </Menu.DropdownMenuSubContent>
                    </Menu.DropdownMenuSub>
                  </Menu.DropdownMenuGroup>
                </Menu.DropdownMenuContent>
              </Menu.DropdownMenu>
              <Tooltip content={t("app.summary")}>
                <Button
                  focus="inset"
                  size="icon"
                  variant="ghost"
                  aria-label={t("app.summary")}
                  aria-expanded={summary}
                  onClick={() => setSummary(!summary)}
                >
                  <ListTree />
                </Button>
              </Tooltip>
            </>
          ) : null}
        </div>
      </header>
      <div inert={settingsOpen} className="flex min-h-0 flex-1">
        <nav
          aria-label={t("app.home")}
          className="app-navigation flex shrink-0 flex-col items-center p-2"
        >
          <Tooltip content={t("app.home")} side="right">
            <Button
              focus="inset"
              size="icon"
              variant="ghost"
              aria-label={t("app.home")}
              aria-current="page"
              className="bg-(--layout-content)"
              onClick={() => newChat(null)}
            >
              <Home className="fill-current" />
            </Button>
          </Tooltip>
          <Button
            focus="inset"
            className="mt-auto"
            size="icon"
            variant="ghost"
            aria-label={t("services.title")}
            onClick={(event) => {
              settingsOpener.current = event.currentTarget;
              setSettingsOpen(true);
            }}
          >
            <Settings />
          </Button>
        </nav>
        <div className="app-workspace relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {sidebar ? (
            <>
              <button
                type="button"
                aria-label={t("app.close-sidebar")}
                className={`absolute inset-0 ${OVERLAY_LAYER.navigationScrim} cursor-pointer bg-(--layout-content)/60 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:hidden`}
                onClick={() => {
                  setSidebar(false);
                  sidebarToggle.current?.focus();
                }}
              />
              <div
                className={`absolute inset-y-0 left-0 ${OVERLAY_LAYER.navigation} md:relative md:z-auto`}
              >
                <Sidebar
                  recent={recent}
                  homeDir={state.homeDir}
                  detailProject={detailProject}
                  detailEpoch={detailEpoch}
                  detailsDisabled={detailsDisabled}
                  onDetailProject={(id, open) =>
                    setDetailProject((previous) =>
                      open
                        ? previous?.pinned
                          ? previous
                          : { id, pinned: false }
                        : previous?.id === id
                          ? null
                          : previous,
                    )
                  }
                  onDetailPin={(id, pinned) =>
                    setDetailProject((previous) =>
                      previous?.id === id ? { ...previous, pinned } : previous,
                    )
                  }
                  onEditProject={setEditingProject}
                  onRenameProject={setRenamingProject}
                  onRevealProject={(project) =>
                    safe(() => client.request({ type: "host.revealPath", path: project.primary }))
                  }
                  onRemoveProject={setRemovingProject}
                  projects={state.projects}
                  pinned={state.pinned}
                  archived={state.archived}
                  preferences={state.preferences}
                  selected={state.selected}
                  onSelect={(id) => safe(() => select(id))}
                  onNew={newChat}
                  onSearch={openSearch}
                  onAdd={() => safe(addProject)}
                  onPin={pin}
                  onRename={setRenaming}
                  onArchive={archive}
                  onDelete={setDeleting}
                  onMove={move}
                  onChooseFolder={chooseMoveFolder}
                  onPreferences={preferences}
                />
              </div>
            </>
          ) : null}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {state.selected ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {Conversation ? (
                  <Conversation
                    key={state.selected}
                    footer={footer}
                    sessionId={state.selected}
                    view={view}
                    connected={connected}
                    summaryOpen={summary}
                    onCloseSummary={() => setSummary(false)}
                    request={client.request}
                    onInteractionResolved={(epoch, decision) =>
                      store.resolveInteraction(state.selected!, epoch, decision)
                    }
                    draft={draft}
                    onDraft={setDraft}
                    images={images}
                    onImages={setImages}
                  />
                ) : (
                  <div className="min-h-0 flex-1" />
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <h1 className="text-center text-ui-xl font-medium">
                  {targetProject ? (
                    <Menu.DropdownMenu>
                      <Menu.DropdownMenuTrigger asChild>
                        <Button
                          size="contextual"
                          variant="ghost"
                          className="min-h-0 rounded-md p-0 text-ui-xl font-medium text-current not-disabled:hover:bg-transparent not-disabled:hover:text-current"
                        >
                          {t("app.project-welcome", { project: targetProject.name })}
                        </Button>
                      </Menu.DropdownMenuTrigger>
                      <Menu.DropdownMenuContent>
                        <Menu.DropdownMenuGroup>
                          <Menu.DropdownMenuItem onSelect={() => store.select(null, null)}>
                            {t("app.workspace")}
                          </Menu.DropdownMenuItem>
                          {state.projects.map((project) => (
                            <Menu.DropdownMenuItem
                              key={project.id}
                              onSelect={() => newChat(project.id)}
                            >
                              {project.name}
                            </Menu.DropdownMenuItem>
                          ))}
                        </Menu.DropdownMenuGroup>
                      </Menu.DropdownMenuContent>
                    </Menu.DropdownMenu>
                  ) : (
                    t("app.welcome")
                  )}
                </h1>
              </div>
            )}
            {!state.selected ? footer() : null}
          </main>
        </div>
      </div>
      {settingsOpen ? (
        <ModelServices
          getAppearance={getAppearance}
          services={host.modelServices}
          request={client.request}
          onChanged={async () => {
            store.setModels(await client.request({ type: "models.list" }));
          }}
        />
      ) : null}
      {goalRemoval ? (
        <GoalConfirmation
          intent="remove"
          onClose={() => changeGoalRemoval(null)}
          onConfirm={async () => {
            const origin = goalRemoval;
            // State may publish removal before the response. Only this confirmed invocation owns focus.
            goalRemovalFocus.current = origin;
            try {
              await client.request({ type: "session.goal_clear", sessionId: origin.sessionId });
            } catch (reason) {
              if (goalRemovalOwner.current === origin) goalRemovalFocus.current = null;
              throw reason;
            }
            // Dismissal ends presentation ownership without cancelling the already sent command.
            finishGoalRemoval(origin);
          }}
        />
      ) : null}
      {goalConfirmation ? (
        <GoalConfirmation
          onClose={() => changeGoalConfirmation(null)}
          onConfirm={async () => {
            const origin = goalConfirmation;
            if (origin.sessionId)
              await client.request({
                type: "session.set_permission_mode",
                sessionId: origin.sessionId,
                mode: "full-access",
              });
            else
              setDrafts((previous) => ({
                ...previous,
                [origin.key]: {
                  ...(previous[origin.key] ?? emptyDraft),
                  permissionMode: "full-access",
                },
              }));
            // Closing C42 invalidates its authority to arm the draft, even if permission changes later succeed.
            if (goalConfirmationOwner.current !== origin) return;
            setGoalEnabled(origin.key, true);
            changeGoalConfirmation(null);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteSession
          session={state.sessions.find((session) => session.id === deleting.id) ?? deleting}
          onClose={() => setDeleting(null)}
          onDelete={() => client.request({ type: "session.delete", sessionId: deleting.id })}
        />
      ) : null}
      {renamingProject ? (
        <RenameProject
          project={
            state.projects.find((project) => project.id === renamingProject.id) ?? renamingProject
          }
          onClose={() => setRenamingProject(null)}
          onSave={(name) => {
            const project =
              state.projects.find((candidate) => candidate.id === renamingProject.id) ??
              renamingProject;
            return client.request({
              type: "project.update",
              projectId: project.id,
              name,
              directories: project.directories,
              primary: project.primary,
            });
          }}
        />
      ) : null}
      {removingProject ? (
        <ProjectRemove
          project={
            state.projects.find((project) => project.id === removingProject.id) ?? removingProject
          }
          busy={projectBusy(removingProject.id)}
          connected={connected}
          onRemove={() => client.request({ type: "project.remove", projectId: removingProject.id })}
          onCancel={() => setRemovingProject(null)}
          onRemoved={() => setRemovingProject(null)}
        />
      ) : null}
      {renaming ? (
        <RenameSession
          session={renaming}
          onClose={() => setRenaming(null)}
          onSave={(title) =>
            client.request({ type: "session.rename", sessionId: renaming.id, title })
          }
        />
      ) : null}
      <CommandPalette
        open={search}
        onOpenChange={changeSearch}
        placeholder={t("app.search")}
        items={[
          ...searchSessions.map((session) => ({
            id: session.id,
            label: session.title,
            group: t("app.chats"),
            keywords: [
              state.projects.find((project) => project.id === session.projectId)?.name ?? "",
            ],
            status: session.running ? (
              <LoaderCircle
                aria-label={t("app.running")}
                className="size-3 animate-spin motion-reduce:animate-none"
              />
            ) : undefined,
            badge: state.projects.find((project) => project.id === session.projectId)?.name,
            onSelect: () => safe(() => select(session.id)),
          })),
          {
            id: "action-new-chat",
            label: t("app.new-chat"),
            group: t("app.quick-actions"),
            section: "actions",
            icon: Plus,
            onSelect: () => newChat(null),
          },
          {
            id: "action-open-folder",
            label: t("app.open-folder"),
            group: t("app.quick-actions"),
            section: "actions",
            icon: Folder,
            onSelect: () => safe(addProject),
          },
        ]}
      />
      {trust ? (
        <ProjectTrust
          project={trust.project}
          creating={trust.creating}
          onConfirm={trust.confirm}
          onCancel={trust.cancel}
        />
      ) : null}
      {!trust && pathOpen ? (
        <ProjectCreate
          name={projectName}
          directories={directories}
          primary={primary}
          error={projectError}
          picking={pickingFolder}
          connected={connected}
          onName={setProjectName}
          onPick={() => {
            void pickFolder();
          }}
          onPrimary={setPrimary}
          onRemove={removeDirectory}
          onCreate={confirmProject}
          onClose={closePath}
        />
      ) : null}
      {editingProject ? (
        <ProjectEdit
          key={editingProject.id}
          project={
            state.projects.find((project) => project.id === editingProject.id) ?? editingProject
          }
          busy={projectBusy(editingProject.id)}
          connected={connected}
          onPick={async () => {
            if (!host.pickProjectFolder) throw new WireError("unsupported");
            return host.pickProjectFolder();
          }}
          onSave={(draft) =>
            client.request({ type: "project.update", projectId: editingProject.id, ...draft })
          }
          onRemove={() => client.request({ type: "project.remove", projectId: editingProject.id })}
          onClose={() => setEditingProject(null)}
        />
      ) : null}
    </div>
  );
}
