import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type SetStateAction,
} from "react";
import {
  Folder,
  Home,
  ListTree,
  MessageSquare,
  PanelLeft,
  Ellipsis,
  WifiOff,
  LoaderCircle,
} from "lucide-react";
import type { Locale } from "@rukie/i18n";
import type { PermissionMode, WirePreferences } from "@rukie/shared";
import { createWireClient, WireError, type ClientCommand } from "../client";
import { createDesktopStore, recentSessions, type SessionViewState } from "../store";
import type { DesktopHost } from "../host";
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
import { AppConversation } from "./conversation";

export type AppHost = Pick<DesktopHost, "getConnection"> &
  Partial<Omit<DesktopHost, "getConnection">>;
export interface ConversationProps {
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
  const [store] = useState(createDesktopStore);
  const [client] = useState(() => createWireClient(host));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [sidebar, setSidebar] = useState(() => matchMedia("(min-width: 768px)").matches);
  const [ctrl, setCtrl] = useState(false);
  const [search, setSearch] = useState(false);
  const [summary, setSummary] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, InputDraft>>({});
  const newDraftSequence = useRef(0);
  const [newDraftKey, setNewDraftKey] = useState("new-0");
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
  const [sending, setSending] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const recent = useMemo(() => recentSessions(state), [state.sessions, state.preferences]);
  const current = state.sessions.find((session) => session.id === state.selected);
  const view = state.selected ? (state.views[state.selected] ?? emptyView) : emptyView;
  const targetProject = state.projects.find((project) => project.id === state.target);
  const currentProject = state.projects.find((project) => project.path === current?.cwd);
  const connected = state.connection === "connected";
  const safe = (action: () => Promise<unknown>) => {
    void action().catch((reason) =>
      setError(
        t("app.error", { message: reason instanceof Error ? reason.message : String(reason) }),
      ),
    );
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
  const pin = (id: string, pinned: boolean) =>
    safe(() => client.request({ type: pinned ? "session.pin" : "session.unpin", sessionId: id }));
  const preferences = (preferences: WirePreferences) =>
    safe(() => client.request({ type: "preferences.set", preferences }));
  const openSearch = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearch(true);
  };
  const changeSearch = (open: boolean) => {
    if (open && !search)
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearch(open);
    if (!open) opener.current?.focus();
  };
  useEffect(() => {
    const offMessages = client.subscribeMessages(store.receive);
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
  }, [recent, state.selected, state.pinned, summary]);
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
          modelSelection: model,
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
      if (folder) await client.request({ type: "project.add", path: folder });
    } else {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPathOpen(true);
    }
  };
  const closePath = () => {
    setPathOpen(false);
    opener.current?.focus();
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
  const status = Object.fromEntries(
    Object.entries(state.views).map(([id, value]) => [
      id,
      Object.keys(value.interactions).length
        ? ("waiting" as const)
        : value.running
          ? ("running" as const)
          : undefined,
    ]),
  );
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-card text-ui-base text-foreground">
      <header className="flex h-11 shrink-0 items-center [-webkit-app-region:drag]">
        <div
          className={cn(
            "flex h-full shrink-0 items-center gap-1 px-3 [-webkit-app-region:no-drag]",
            sidebar && "md:w-76",
          )}
        >
          <span aria-hidden="true" className="w-16" />
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
        </div>
        <div
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-2 px-3 [-webkit-app-region:no-drag]",
            sidebar && "md:border-l md:border-border",
          )}
        >
          {current ? (
            <>
              <Tooltip content={currentProject?.name ?? t("app.conversations")}>
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={currentProject?.name ?? t("app.conversations")}
                  className="rounded-md p-1 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    <Menu.DropdownMenuItem
                      onSelect={() => pin(current.id, !state.pinned.includes(current.id))}
                    >
                      {t(state.pinned.includes(current.id) ? "app.unpin" : "app.pin")}
                      <Menu.DropdownMenuShortcut>⌥⌘P</Menu.DropdownMenuShortcut>
                    </Menu.DropdownMenuItem>
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
                    {host.revealPath || host.openInTerminal ? (
                      <Menu.DropdownMenuSub>
                        <Menu.DropdownMenuSubTrigger>{t("app.open")}</Menu.DropdownMenuSubTrigger>
                        <Menu.DropdownMenuSubContent>
                          {host.revealPath ? (
                            <Menu.DropdownMenuItem
                              onSelect={() => safe(() => host.revealPath!(current.cwd))}
                            >
                              {t("app.finder")}
                            </Menu.DropdownMenuItem>
                          ) : null}
                          {host.openInTerminal ? (
                            <Menu.DropdownMenuItem
                              onSelect={() => safe(() => host.openInTerminal!(current.cwd))}
                            >
                              {t("app.terminal")}
                            </Menu.DropdownMenuItem>
                          ) : null}
                        </Menu.DropdownMenuSubContent>
                      </Menu.DropdownMenuSub>
                    ) : null}
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
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t("app.home")} className="flex w-12 shrink-0 flex-col items-center p-2">
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
        </nav>
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-xl border-l border-t border-border bg-background">
          {sidebar ? (
            <>
              <button
                aria-label={t("app.toggle-sidebar")}
                className="absolute inset-0 z-10 bg-background/60 md:hidden"
                onClick={() => setSidebar(false)}
              />
              <div className="absolute inset-y-0 left-0 z-20 md:relative md:z-auto">
                <Sidebar
                  sessions={state.sessions}
                  recent={recent}
                  projects={state.projects}
                  pinned={state.pinned}
                  preferences={state.preferences}
                  selected={state.selected}
                  ctrl={ctrl}
                  status={status}
                  onSelect={(id) => safe(() => select(id))}
                  onNew={newChat}
                  onSearch={openSearch}
                  onAdd={() => safe(addProject)}
                  onPin={pin}
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
            <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-2 px-3 pb-4 sm:px-6">
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
                <div role="status" className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center gap-2">
                    {state.connection === "reconnecting" ? (
                      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <WifiOff className="size-4" />
                    )}
                    <span>
                      {t(
                        state.connection === "reconnecting"
                          ? "app.reconnecting"
                          : "app.disconnected",
                      )}
                    </span>
                    {state.connection === "disconnected" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => safe(() => client.connect())}
                      >
                        {t("app.retry")}
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-ui-sm text-muted-foreground">
                    {t("app.connection-explanation")}
                  </p>
                </div>
              ) : null}
              {error ? (
                <p role="alert" className="text-ui-sm text-danger">
                  {error}
                </p>
              ) : null}
              {view.busy ? (
                <div
                  role="status"
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
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
                      : model
                        ? `${model.provider}/${model.modelId}`
                        : state.models.find((model) => model.authenticated)?.spec
                  }
                  thinkingLevel={view.thinkingLevel ?? model?.thinkingLevel}
                  contextReport={view.contextReport}
                  openingContext={view.openingContext}
                  compactionPoints={view.snapshot?.compactions.length}
                  onModel={setSelection}
                  onSend={() => safe(send)}
                  onStop={() => safe(stop)}
                />
              )}
            </div>
          </main>
        </div>
      </div>
      <CommandPalette
        open={search}
        onOpenChange={changeSearch}
        placeholder={t("app.search")}
        emptyLimit={8}
        items={recent.map((session) => ({
          id: session.id,
          label: session.title,
          group: t("app.recent"),
          keywords: [
            state.projects.find((project) => project.path === session.cwd)?.name ??
              t("app.conversations"),
          ],
          icon: state.projects.some((project) => project.path === session.cwd)
            ? Folder
            : MessageSquare,
          badge: (
            <span className="text-ui-xs text-muted-foreground">
              {state.projects.find((project) => project.path === session.cwd)?.name ??
                t("app.conversations")}{" "}
              · {new Date(session.updatedAt).toLocaleDateString()}
            </span>
          ),
          onSelect: () => safe(() => select(session.id)),
        }))}
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
          className="flex flex-col gap-4"
        >
          <h2 className="text-ui-lg font-medium">{t("app.add-project")}</h2>
          <Input autoFocus label={t("app.project-path")} value={path} onChange={setPath} />
          <div className="flex justify-end gap-2">
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
