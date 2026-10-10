import { createStore } from "zustand/vanilla";
import type { SessionEvent } from "@rukie/agent";
import type {
  WireServerMessage,
  WireSessionSummary,
  WireProject,
  WirePreferences,
  WireModelCatalogEntry,
  WirePermissionRequest,
  PermissionMode,
  ThinkingLevel,
  ContextReport,
} from "@rukie/shared";
import { WireError, type ConnectionState } from "../client";
import { THINKING_LEVELS, PERMISSION_MODES } from "@rukie/shared";

type SessionSnapshot = Extract<SessionEvent, { type: "snapshot" }>;
export interface SessionViewState {
  snapshot?: SessionSnapshot;
  events: SessionEvent[];
  interactions: Record<string, WirePermissionRequest>;
  busy: boolean;
  running?: boolean;
  permissionMode?: PermissionMode;
  thinkingLevel?: ThinkingLevel;
  contextReport?: ContextReport;
  openingContext?: number;
}
export interface DesktopState {
  connection: ConnectionState;
  sessions: WireSessionSummary[];
  projects: WireProject[];
  pinned: string[];
  preferences: WirePreferences;
  models: WireModelCatalogEntry[];
  views: Record<string, SessionViewState>;
  selected: string | null;
  target: string | null;
}
export function createDesktopStore() {
  const store = createStore<DesktopState>(() => ({
    connection: "disconnected",
    sessions: [],
    projects: [],
    pinned: [],
    preferences: {},
    models: [],
    views: {},
    selected: null,
    target: null,
  }));
  /** Validate consumed envelope facts; Agent payloads remain opaque until their presentation owner reads them. */
  const receive = (input: unknown) => {
    if (!validEnvelope(input)) return;
    // The guard checks this layer’s accessed fields; raw Agent payload contents remain opaque.
    const message = input as WireServerMessage<SessionEvent>;
    if (message.type === "sessions_changed") {
      store.setState({
        sessions: message.sessions,
        projects: message.projects,
        pinned: message.pinned,
        preferences: message.preferences,
      });
      return;
    }
    if (message.type === "response" || !("sessionId" in message)) return;
    const state = store.getState();
    const previous = state.views[message.sessionId] ?? {
      events: [],
      interactions: {},
      busy: false,
    };
    let next: SessionViewState;
    if (message.type === "interaction_requested")
      next = {
        ...previous,
        interactions: { ...previous.interactions, [message.identity.epoch]: message.request },
      };
    else if (message.type === "interaction_settled") {
      const interactions = { ...previous.interactions };
      delete interactions[message.identity.epoch];
      next = { ...previous, interactions };
    } else if (message.type === "session_state")
      next = {
        ...previous,
        permissionMode: message.permissionMode,
        thinkingLevel: message.thinkingLevel,
        contextReport: message.contextReport,
        openingContext:
          previous.openingContext ??
          message.contextReport.categories
            .filter(
              (category) =>
                !["messages", "free-space", "compaction-reserve"].includes(category.name),
            )
            .reduce((total, category) => total + category.tokens, 0),
      };
    else if (message.type === "snapshot")
      next = { ...previous, snapshot: message, events: [], running: Boolean(message.run) };
    else
      next = {
        ...previous,
        events: [...previous.events, message],
        ...(message.type === "run_start"
          ? { running: true }
          : message.type === "run_end"
            ? { running: false }
            : {}),
      };
    store.setState({ views: { ...state.views, [message.sessionId]: next } });
  };
  const select = (selected: string | null, target: string | null = null) =>
    store.setState({ selected, target });
  const setBusy = (sessionId: string, busy: boolean) => {
    const state = store.getState();
    store.setState({
      views: {
        ...state.views,
        [sessionId]: {
          ...state.views[sessionId],
          events: state.views[sessionId]?.events ?? [],
          interactions: state.views[sessionId]?.interactions ?? {},
          busy,
        },
      },
    });
  };
  const setModels = (input: unknown) => {
    if (!Array.isArray(input) || !input.every(isModel)) throw new WireError("invalid_command");
    store.setState({ models: input });
  };
  return { ...store, receive, select, setBusy, setModels };
}
export function recentSessions(state: Pick<DesktopState, "sessions" | "preferences">) {
  const field = state.preferences.sort === "created" ? "createdAt" : "updatedAt";
  return [...state.sessions].sort((a, b) => b[field] - a[field] || a.id.localeCompare(b.id));
}

function isModel(value: unknown): value is WireModelCatalogEntry {
  if (typeof value !== "object" || value === null) return false;
  return (
    "spec" in value &&
    typeof value.spec === "string" &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "providerId" in value &&
    typeof value.providerId === "string" &&
    "providerName" in value &&
    typeof value.providerName === "string" &&
    "input" in value &&
    Array.isArray(value.input) &&
    value.input.every((input) => input === "text" || input === "image") &&
    "reasoning" in value &&
    typeof value.reasoning === "boolean" &&
    "thinkingLevels" in value &&
    Array.isArray(value.thinkingLevels) &&
    value.thinkingLevels.every((level) => THINKING_LEVELS.some((known) => known === level)) &&
    "contextWindow" in value &&
    typeof value.contextWindow === "number" &&
    Number.isFinite(value.contextWindow) &&
    value.contextWindow > 0 &&
    "custom" in value &&
    typeof value.custom === "boolean" &&
    "authenticated" in value &&
    typeof value.authenticated === "boolean"
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function identity(value: unknown) {
  return (
    record(value) &&
    typeof value.epoch === "string" &&
    typeof value.requestId === "string" &&
    Number.isInteger(value.taskId) &&
    Number.isInteger(value.conversationId)
  );
}
function validEnvelope(input: unknown): boolean {
  if (!record(input) || typeof input.type !== "string") return false;
  if (input.type === "sessions_changed") {
    if (
      !Array.isArray(input.sessions) ||
      !input.sessions.every(
        (item) =>
          record(item) &&
          [item.id, item.title, item.model, item.cwd].every((value) => typeof value === "string") &&
          ["prompt", "model", "user"].includes(String(item.titleSource)) &&
          finite(item.createdAt) &&
          finite(item.updatedAt) &&
          finite(item.messageCount) &&
          (item.running === undefined || typeof item.running === "boolean") &&
          (item.waitingPermission === undefined || typeof item.waitingPermission === "boolean"),
      )
    )
      return false;
    if (
      !Array.isArray(input.projects) ||
      !input.projects.every(
        (item) =>
          record(item) &&
          [item.id, item.path, item.name].every((value) => typeof value === "string"),
      ) ||
      !strings(input.pinned) ||
      !record(input.preferences)
    )
      return false;
    const prefs = input.preferences;
    return (
      (prefs.sort === undefined || prefs.sort === "updated" || prefs.sort === "created") &&
      [prefs.showPinned, prefs.showProjects, prefs.showConversations].every(
        (value) => value === undefined || typeof value === "boolean",
      ) &&
      [prefs.collapsedGroups, prefs.collapsedProjects].every(
        (value) => value === undefined || strings(value),
      )
    );
  }
  if (typeof input.sessionId !== "string") return false;
  if (input.type === "session_state")
    return (
      PERMISSION_MODES.some((mode) => mode === input.permissionMode) &&
      THINKING_LEVELS.some((level) => level === input.thinkingLevel) &&
      record(input.contextReport) &&
      finite(input.contextReport.window) &&
      finite(input.contextReport.used) &&
      Array.isArray(input.contextReport.categories) &&
      input.contextReport.categories.every(
        (category) =>
          record(category) && typeof category.name === "string" && finite(category.tokens),
      )
    );
  if (input.type === "interaction_settled") return identity(input.identity);
  if (input.type === "interaction_requested")
    return (
      identity(input.identity) &&
      record(input.request) &&
      typeof input.request.toolName === "string" &&
      typeof input.request.toolCallId === "string" &&
      PERMISSION_MODES.some((mode) => record(input.request) && mode === input.request.mode) &&
      record(input.request.sessionAllow) &&
      ["tool", "command", "directory", "domain"].includes(
        String(input.request.sessionAllow.kind),
      ) &&
      typeof input.request.sessionAllow.rule === "string"
    );
  if (input.type === "snapshot")
    return (
      Array.isArray(input.messages) &&
      Array.isArray(input.compactions) &&
      typeof input.model === "string"
    );
  // Session deltas are stored without inspecting their payload; Conversation owns validation before use.
  return true;
}
