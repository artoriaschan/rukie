import type { ProviderIconKey } from "./model-services.ts";
import { Type, type Static, type TSchema } from "typebox";
import type { ContextReport } from "./context-report.ts";
import type { ToolCallView } from "./tool-view.ts";
import {
  PERMISSION_MODES,
  THINKING_LEVELS,
  type PermissionMode,
  type ThinkingLevel,
} from "./settings.ts";

import { ModelServiceSaveSchema, ModelPriceRequestSchema } from "./model-services.ts";

export const WIRE_SUBPROTOCOL = "rukie.v1";
const id = Type.String({ minLength: 1 });
const session = { sessionId: id };
const image = Type.Object(
  { data: Type.String(), mimeType: Type.String(), name: Type.Optional(Type.String()) },
  { additionalProperties: false },
);
const prompt = { text: Type.String({ minLength: 1 }), images: Type.Optional(Type.Array(image)) };
const identity = Type.Object(
  { requestId: id, taskId: Type.Integer(), conversationId: Type.Integer(), epoch: id },
  { additionalProperties: false },
);
function command<const Name extends string, Fields extends Record<string, TSchema>>(
  name: Name,
  fields: Fields,
) {
  return Type.Object({ id, type: Type.Literal(name), ...fields }, { additionalProperties: false });
}
export const WirePreferencesSchema = Type.Object(
  {
    sort: Type.Optional(Type.Union([Type.Literal("updated"), Type.Literal("created")])),
    showPinned: Type.Optional(Type.Boolean()),
    showConversations: Type.Optional(Type.Boolean()),
    showProjects: Type.Optional(Type.Boolean()),
    collapsedGroups: Type.Optional(Type.Array(Type.String())),
    collapsedProjects: Type.Optional(Type.Array(Type.String())),
    /** Project ids shown in Pinned instead of Projects, in pin order. */
    pinnedProjects: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

/** Client commands are untrusted input; server messages use TypeScript types. */
export const WireCommandSchema = Type.Union([
  command("modelServices.list", {}),
  command("modelServices.save", ModelServiceSaveSchema.properties),
  command("modelServices.delete", {
    providerId: Type.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" }),
  }),
  command("modelServices.revealKey", {
    providerId: Type.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" }),
  }),
  command("modelServices.test", {
    providerId: Type.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
  }),
  command("modelServices.prices", ModelPriceRequestSchema.properties),
  command("host.pickFolder", { multiple: Type.Optional(Type.Boolean()) }),
  command("host.revealPath", { path: id }),
  command("host.openInTerminal", { path: id }),
  command("projects.list", {}),
  command("project.create", {
    name: Type.String(),
    directories: Type.Array(id, { minItems: 1, uniqueItems: true }),
    trusted: Type.Literal(true),
  }),
  command("project.update", {
    projectId: id,
    name: Type.String(),
    directories: Type.Array(id, { minItems: 1, uniqueItems: true }),
    primary: id,
    trusted: Type.Optional(Type.Boolean()),
  }),
  command("project.remove", { projectId: id }),
  command("project.trust", { projectId: id }),
  command("project.git", { projectId: id }),
  command("project.checkout", { projectId: id, branch: Type.String({ minLength: 1 }) }),
  command("project.createBranch", { projectId: id, branch: Type.String({ minLength: 1 }) }),
  command("worktrees.list", {}),
  command("worktrees.refresh", {}),
  command("worktree.delete", { worktreeId: id }),
  command("sessions.list", {}),
  command("session.create", {
    project: Type.Union([id, Type.Null()]),
    ...prompt,
    modelSelection: Type.Optional(
      Type.Object(
        {
          provider: id,
          modelId: id,
          thinkingLevel: Type.Optional(Type.Enum(["automatic", ...THINKING_LEVELS])),
        },
        { additionalProperties: false },
      ),
    ),
    permissionMode: Type.Optional(Type.Enum([...PERMISSION_MODES])),
    worktree: Type.Optional(Type.Boolean()),
  }),
  command("session.subscribe", session),
  command("session.unsubscribe", session),
  command("tool_output.read", {
    ...session,
    outputRef: Type.Object({ id }, { additionalProperties: false }),
    offset: Type.Integer({ minimum: 0 }),
    maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 * 1024 * 1024 })),
  }),
  command("prompt", { ...session, ...prompt }),
  command("steer_now", { ...session, requestId: id }),
  command("withdraw", { ...session, requestId: id }),
  command("abort", session),
  command("session.rename", { ...session, title: Type.String({ minLength: 1 }) }),
  command("session.pin", session),
  command("session.unpin", session),
  command("session.move", { ...session, projectId: Type.Union([id, Type.Null()]) }),
  command("session.archive", session),
  command("session.delete", session),
  command("models.list", {}),
  command("session.set_model", {
    ...session,
    provider: id,
    modelId: id,
    thinkingLevel: Type.Optional(Type.Enum(["automatic", ...THINKING_LEVELS])),
  }),
  command("session.set_permission_mode", {
    ...session,
    mode: Type.Enum([...PERMISSION_MODES]),
  }),
  command("interaction.reply", {
    identity,
    reply: Type.Union([Type.Literal("deny"), Type.Literal("allow-session"), Type.Literal("allow")]),
  }),
  command("preferences.set", {
    preferences: WirePreferencesSchema,
  }),
]);
export type WireCommand = Static<typeof WireCommandSchema>;

export type WireErrorCode =
  | "worktree_failed"
  | "branch_invalid"
  | "git_failed"
  | "worktree_session"
  | "model_services_unavailable"
  | "model_unavailable"
  | "session_busy"
  | "session_archived"
  | "session_not_found"
  | "project_not_found"
  | "project_conflict"
  | "project_reserved"
  | "project_trust_required"
  | "invalid_command"
  | "not_queued"
  | "interaction_stale"
  | "unsupported"
  | "internal";
export type WireResponse<Result = unknown> = { type: "response"; id: string } & (
  | { result: Result; error?: never }
  | { error: { code: WireErrorCode; params?: Record<string, string | number> }; result?: never }
);
export interface WireProject {
  id: string;
  name: string;
  directories: string[];
  primary: string;
  trusted: boolean;
}
export interface WireProjectGit {
  repository: boolean;
  branch: string | null;
  head: string;
  /** Local branches the primary folder can switch to, sorted; excludes those checked out elsewhere. */
  branches: string[];
}
export interface WireWorktree {
  id: string;
  projectId: string;
  repository: string;
  branch: string;
  path: string;
  createdAt: number;
}
export interface WireSessionSummary {
  id: string;
  title: string;
  titleSource: "prompt" | "model" | "user";
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  model: string;
  cwd: string;
  /** Persistent Project ownership; cwd keeps its persisted spelling. */
  projectId: string | null;
  worktree: { id: string; branch: string } | null;
  running?: boolean;
  waitingPermission?: boolean;
}

export interface WireInteractionIdentity {
  requestId: string;
  taskId: number;
  conversationId: number;
  epoch: string;
}
export interface WirePermissionRequest {
  identity: WireInteractionIdentity;
  toolCallId: string;
  toolName: string;
  args: unknown;
  callView?: ToolCallView;
  mode: PermissionMode;
  reason?: string;
  sessionAllow: { kind: "command" | "directory" | "domain" | "tool"; rule: string };
  origin?: { agentId: string; description: string };
}
export type WirePreferences = Extract<WireCommand, { type: "preferences.set" }>["preferences"];
export interface WireModelCatalogEntry {
  spec: string;
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  providerIcon?: ProviderIconKey;
  input: ("text" | "image")[];
  reasoning: boolean;
  thinkingLevels: ThinkingLevel[];
  contextWindow: number;
  custom: boolean;
  authenticated: boolean;
}
export interface WireSessionState {
  type: "session_state";
  sessionId: string;
  permissionMode: PermissionMode;
  thinkingLevel: ThinkingLevel;
  contextReport: ContextReport;
}
export type WireServerMessage<Event> =
  | Event
  | WireResponse
  | WireSessionState
  | {
      type: "interaction_requested";
      sessionId: string;
      identity: WireInteractionIdentity;
      request: WirePermissionRequest;
    }
  | { type: "interaction_settled"; sessionId: string; identity: WireInteractionIdentity }
  | {
      type: "sessions_changed";
      /** Configured home identity (canonical when available), for frontend path presentation only. */
      homeDir: string;
      /** Invalidate cached history; an archived selected Session also returns to new chat. */
      closedSessionId?: string;
      sessions: WireSessionSummary[];
      projects: WireProject[];
      pinned: string[];
      archived: string[];
      preferences: WirePreferences;
    };
