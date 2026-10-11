import { createStore } from "zustand/vanilla";
import type { SessionEvent } from "@rukie/agent";
import type {
  WireServerMessage,
  WireSessionSummary,
  WireProject,
  WirePreferences,
  WireModelCatalogEntry,
  PermissionMode,
  ThinkingLevel,
  ContextReport,
} from "@rukie/shared";
import { WireError, type ConnectionState } from "../client";
import { Value } from "typebox/value";
import { ToolCallViewSchema, THINKING_LEVELS, PERMISSION_MODES } from "@rukie/shared";

import { reduceTranscript } from "./transcript";
import type {
  TranscriptState,
  PermissionDecision,
  PresentedPermissionRequest,
} from "../lib/transcript";

type SessionSnapshot = Extract<SessionEvent, { type: "snapshot" }>;
export interface SessionViewState {
  snapshot?: SessionSnapshot;
  transcript?: TranscriptState;
  interactions: Record<string, PresentedPermissionRequest>;
  permissionDecisions?: Record<string, PermissionDecision>;
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
      interactions: {},
      busy: false,
    };
    let next: SessionViewState;
    if (message.type === "interaction_requested") {
      const group = previous.transcript?.groups.at(-1);
      const calls = !message.request.origin
        ? group?.messages.filter(
            (item) =>
              item.role === "assistant" &&
              item.content.some(
                (block) => block.type === "toolCall" && block.id === message.request.toolCallId,
              ),
          )
        : undefined;
      const latest = calls?.at(-1);
      // A late streaming update can accompany its committed entry. Prefer that entry,
      // without rebinding a new partial call to an older reused provider call ID.
      const anchor =
        (latest && !latest.entryId
          ? (calls?.findLast((item) => item.entryId && item.timestamp === latest.timestamp) ??
            latest)
          : latest) ?? group?.messages.at(-1);
      const index =
        anchor?.role === "assistant"
          ? anchor.content.findIndex(
              (block) => block.type === "toolCall" && block.id === message.request.toolCallId,
            )
          : -1;
      const placement =
        group && anchor
          ? {
              groupId: group.id,
              entryId: anchor.entryId,
              timestamp: anchor.timestamp,
              blockIndex:
                index >= 0 && !message.request.origin
                  ? index
                  : anchor.role === "assistant"
                    ? anchor.content.length - 1
                    : -1,
              before: index >= 0 && !message.request.origin,
            }
          : undefined;
      next = {
        ...previous,
        interactions: {
          ...previous.interactions,
          [message.identity.epoch]: { ...message.request, identity: message.identity, placement },
        },
      };
    } else if (message.type === "interaction_settled") {
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
      next = { ...previous, snapshot: message, running: Boolean(message.run) };
    else
      next = {
        ...previous,
        ...(message.type === "run_start"
          ? { running: true }
          : message.type === "run_end"
            ? { running: false }
            : {}),
      };
    if (!["interaction_requested", "interaction_settled", "session_state"].includes(message.type))
      next.transcript = reduceTranscript(previous.transcript, message as SessionEvent);
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
  const resolveInteraction = (sessionId: string, epoch: string, decision?: PermissionDecision) => {
    const state = store.getState(),
      previous = state.views[sessionId];
    if (!previous) return;
    const interactions = { ...previous.interactions };
    delete interactions[epoch];
    store.setState({
      views: {
        ...state.views,
        [sessionId]: {
          ...previous,
          interactions,
          ...(decision
            ? {
                permissionDecisions: {
                  ...previous.permissionDecisions,
                  [epoch]: decision,
                },
              }
            : {}),
        },
      },
    });
  };
  return { ...store, receive, select, setBusy, setModels, resolveInteraction };
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
      (input.request.callView === undefined ||
        Value.Check(ToolCallViewSchema, input.request.callView)) &&
      (input.request.reason === undefined || typeof input.request.reason === "string") &&
      (input.request.origin === undefined ||
        (record(input.request.origin) &&
          typeof input.request.origin.agentId === "string" &&
          typeof input.request.origin.description === "string")) &&
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
  // Transcript projection validates the fields it consumes from each native delta.
  return true;
}
