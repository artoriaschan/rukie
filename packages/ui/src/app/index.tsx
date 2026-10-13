import {
  useEffect,
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
import type { PermissionMode, WirePreferences, WireSessionSummary } from "@rukie/shared";
import { createWireClient, WireError, type ClientCommand } from "../client";
import { createDesktopStore, recentSessions, type SessionViewState } from "../store";
import type { DesktopHost } from "../host";
import { sessionActions, SessionDropdownItems } from "../components/session-actions";
import { Sidebar } from "../components/sidebar";
import { Composer, type PromptImages, type ModelSelection } from "../components/composer";
import { Button } from "../components/motion/button/base";
import { Tooltip } from "../components/motion/tooltip";
import { CommandPalette } from "../components/motion/command-palette";
import { MorphingModal } from "../components/motion/morphing-modal";
import { Input } from "../components/motion/input";
import * as Menu from "../components/ui/dropdown-menu";
import { UiLocaleProvider, useAppText } from "../lib/i18n";
import { cn } from "../lib/utils";
import type { PermissionDecision } from "../lib/transcript";
import { ModelServices } from "./model-services";
import { AppConversation } from "./conversation";
import { DeleteSession } from "./delete-session";
import { RenameSession } from "./rename-session";
import { useErrorText } from "./error";

export type AppHost = Pick<DesktopHost, "getConnection" | "modelServices"> &
  Partial<Omit<DesktopHost, "getConnection" | "modelServices">>;
export interface ConversationProps {
  footer: (approval?: ReactNode) => ReactNode;
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
}
const emptyDraft: InputDraft = { text: "", images: [], textRevision: 0, imageRevision: 0 };
export function App({ locale = "en", ...props }: AppProps) {
  return (
    <UiLocaleProvider locale={locale}>
      <DesktopApp {...props} />
    </UiLocaleProvider>
  );
}
function DesktopApp({ host, Conversation = AppConversation }: Omit<AppProps, "locale">) {
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
  const [ctrl, setCtrl] = useState(false);
  const [search, setSearch] = useState(false);
  const [summary, setSummary] = useState(false);
  const [deleting, setDeleting] = useState<WireSessionSummary | null>(null);
  const [renaming, setRenaming] = useState<WireSessionSummary | null>(null);
  const [pathOpen, setPathOpen] = useState(false);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, InputDraft>>({});
  const newDraftSequence = useRef(0);
  const [newDraftKey, setNewDraftKey] = useState("new-0");
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
  const [permission, setPermission] = useState<PermissionMode>("ask");
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
    if (!pathOpen) pathOpener.current?.focus();
  }, [pathOpen]);
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
  const targetProject = state.projects.find((project) => project.id === state.target);
  const currentProject = state.projects.find((project) => project.path === current?.cwd);
  const connected = state.connection === "connected";
  const safe = (action: () => Promise<unknown>) => {
    void action().catch((reason) => setError(t("app.error", { message: errorText(reason) })));
  };
  const select = async (sessionId: string) => {
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
  const newChat = (project: string | null) => {
    const previous = store.getState().selected;
    if (previous) safe(() => client.unsubscribe(previous));
    store.select(null, project);
    newDraftSequence.current++;
    setNewDraftKey(`new-${newDraftSequence.current}`);
    setError("");
    setSummary(false);
    if (!matchMedia("(min-width: 768px)").matches) setSidebar(false);
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
      setCtrl(event.ctrlKey);
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
    const keyup = (event: KeyboardEvent) => setCtrl(event.ctrlKey);
    const blur = () => setCtrl(false);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, [recent, state.selected, state.pinned, summary, settingsOpen]);
  const send = async () => {
    if (!connected || sending || !draft.trim()) return;
    setSending(true);
    setError("");
    const text = draft.trim();
    const attachments = images;
    try {
      let createdSessionId: string | undefined;
      if (state.selected)
        await client.request({
          type: "prompt",
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
        await select(createdSessionId);
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
    if (host.pickProjectFolder) {
      const folder = await host.pickProjectFolder();
      if (folder) {
        await client.request({ type: "project.add", path: folder });
        return;
      }
    }
    pathOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPathOpen(true);
  };
  const closePath = () => {
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
  const footer = (approval?: ReactNode) => (
    <div
      className={cn(
        "mx-auto flex w-full min-w-0 flex-col gap-2 px-3 pb-4 sm:px-6",
        approval ? "max-w-3xl" : "max-w-[800px]",
      )}
    >
      {!state.selected ? (
        <Menu.DropdownMenu>
          <Menu.DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="self-start">
              <Folder className="size-4" />
              {targetProject?.name ?? t("app.workspace")}
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
                  onSelect={() => store.select(null, project.id)}
                >
                  {project.name}
                </Menu.DropdownMenuItem>
              ))}
              <Menu.DropdownMenuItem onSelect={() => safe(addProject)}>
                {t("app.add-project")}
              </Menu.DropdownMenuItem>
            </Menu.DropdownMenuGroup>
          </Menu.DropdownMenuContent>
        </Menu.DropdownMenu>
      ) : null}
      {!connected ? (
        <div role="status" className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            {state.connection === "reconnecting" ? (
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <WifiOff className="size-4" />
            )}
            <span>
              {t(state.connection === "reconnecting" ? "app.reconnecting" : "app.disconnected")}
            </span>
            {state.connection === "disconnected" ? (
              <Button size="sm" variant="secondary" onClick={() => safe(() => client.connect())}>
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
              size="sm"
              variant="secondary"
              disabled={!connected}
              onClick={() => state.selected && safe(() => select(state.selected!))}
            >
              {t("app.retry")}
            </Button>
          </div>
        ) : (
          <Composer
            draft={draft}
            images={images}
            onDraft={setDraft}
            onImages={setImages}
            disabled={!connected}
            submitting={sending}
            running={Boolean(view.running)}
            permissionMode={view.permissionMode ?? permission}
            onPermission={setMode}
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
                size="icon"
                variant="ghost"
                aria-label={t("app.toggle-sidebar")}
                aria-pressed={sidebar}
                onClick={() => setSidebar(!sidebar)}
              >
                <PanelLeft className="size-4" />
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
                    <Folder className="size-4" />
                  ) : (
                    <MessageSquare className="size-4" />
                  )}
                </span>
              </Tooltip>
              <h1 className="min-w-0 flex-1 truncate text-ui-base font-medium">{current.title}</h1>
              <Menu.DropdownMenu>
                <Tooltip content={t("app.more")}>
                  <Menu.DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" aria-label={t("app.more")}>
                      <Ellipsis className="size-4" />
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
                      )}
                      shortcuts
                    />
                    <Menu.DropdownMenuSub>
                      <Menu.DropdownMenuSubTrigger>{t("app.copy")}</Menu.DropdownMenuSubTrigger>
                      <Menu.DropdownMenuSubContent>
                        <Menu.DropdownMenuItem
                          onSelect={() => safe(() => navigator.clipboard.writeText(current.id))}
                        >
                          {t("app.copy-id")}
                        </Menu.DropdownMenuItem>
                        <Menu.DropdownMenuItem
                          onSelect={() => safe(() => navigator.clipboard.writeText(current.cwd))}
                        >
                          {t("app.copy-cwd")}
                        </Menu.DropdownMenuItem>
                        <Menu.DropdownMenuItem
                          onSelect={() => safe(() => navigator.clipboard.writeText(markdown()))}
                        >
                          {t("app.copy-markdown")}
                        </Menu.DropdownMenuItem>
                      </Menu.DropdownMenuSubContent>
                    </Menu.DropdownMenuSub>
                    <Menu.DropdownMenuSub>
                      <Menu.DropdownMenuSubTrigger>{t("app.open")}</Menu.DropdownMenuSubTrigger>
                      <Menu.DropdownMenuSubContent>
                        <Menu.DropdownMenuItem
                          onSelect={() =>
                            safe(() =>
                              client.request({ type: "host.revealPath", path: current.cwd }),
                            )
                          }
                        >
                          {t("app.finder")}
                        </Menu.DropdownMenuItem>
                        <Menu.DropdownMenuItem
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
                  size="icon"
                  variant="ghost"
                  aria-label={t("app.summary")}
                  aria-expanded={summary}
                  onClick={() => setSummary(!summary)}
                >
                  <ListTree className="size-4" />
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
              size="icon"
              variant="ghost"
              aria-label={t("app.home")}
              aria-current="page"
              className="bg-background"
              onClick={() => newChat(null)}
            >
              <Home className="size-4 fill-current" />
            </Button>
          </Tooltip>
          <Button
            className="mt-auto"
            size="icon"
            variant="ghost"
            aria-label={t("services.title")}
            onClick={(event) => {
              settingsOpener.current = event.currentTarget;
              setSettingsOpen(true);
            }}
          >
            <Settings className="size-4" />
          </Button>
        </nav>
        <div className="app-workspace relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {sidebar ? (
            <>
              <button
                aria-label={t("app.close-sidebar")}
                className="absolute inset-0 z-10 bg-background/60 md:hidden"
                onClick={() => setSidebar(false)}
              />
              <div className="absolute inset-y-0 left-0 z-20 md:relative md:z-auto">
                <Sidebar
                  recent={recent}
                  projects={state.projects}
                  pinned={state.pinned}
                  archived={state.archived}
                  preferences={state.preferences}
                  selected={state.selected}
                  ctrl={ctrl}
                  onSelect={(id) => safe(() => select(id))}
                  onNew={newChat}
                  onSearch={openSearch}
                  onAdd={() => safe(addProject)}
                  onPin={pin}
                  onRename={setRenaming}
                  onArchive={archive}
                  onDelete={setDeleting}
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
                        <button className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {t("app.project-welcome", { project: targetProject.name })}
                        </button>
                      </Menu.DropdownMenuTrigger>
                      <Menu.DropdownMenuContent>
                        <Menu.DropdownMenuGroup>
                          <Menu.DropdownMenuItem onSelect={() => store.select(null, null)}>
                            {t("app.workspace")}
                          </Menu.DropdownMenuItem>
                          {state.projects.map((project) => (
                            <Menu.DropdownMenuItem
                              key={project.id}
                              onSelect={() => store.select(null, project.id)}
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
          services={host.modelServices}
          onClose={() => setSettingsOpen(false)}
          onChanged={async () => {
            store.setModels(await client.request({ type: "models.list" }));
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
            keywords: [state.projects.find((project) => project.path === session.cwd)?.name ?? ""],
            status: session.running ? (
              <LoaderCircle
                aria-label={t("app.running")}
                className="size-3 animate-spin motion-reduce:animate-none"
              />
            ) : undefined,
            badge: state.projects.find((project) => project.path === session.cwd)?.name,
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
      <MorphingModal
        label={t("app.add-project")}
        viewId={pathOpen ? "path" : null}
        onClose={closePath}
        placement="center"
      >
        <form
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closePath();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            safe(async () => {
              await client.request({ type: "project.add", path });
              setPath("");
              closePath();
            });
          }}
          className="flex min-h-0 flex-col gap-3"
        >
          <h2 className="shrink-0 text-ui-base font-medium">{t("app.add-project")}</h2>
          <div className="min-h-0 overflow-y-auto">
            <Input autoFocus label={t("app.project-path")} value={path} onChange={setPath} />
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={closePath}>
              {t("app.cancel")}
            </Button>
            <Button type="submit" disabled={!path.trim() || !connected}>
              {t("app.add")}
            </Button>
          </div>
        </form>
      </MorphingModal>
    </div>
  );
}
