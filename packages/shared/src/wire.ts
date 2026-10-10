import { Type, type Static, type TSchema } from "typebox";
import type { ContextReport } from "./context-report.ts";
import type { ToolCallView } from "./tool-view.ts";
import {
  PERMISSION_MODES,
  THINKING_LEVELS,
  type PermissionMode,
  type ThinkingLevel,
} from "./settings.ts";

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
  },
  { additionalProperties: false },
);

/** Client commands are untrusted input; server messages use TypeScript types. */
export const WireCommandSchema = Type.Union([
  command("projects.list", {}),
  command("project.add", { path: id }),
  command("sessions.list", {}),
  command("session.create", {
    project: Type.Union([id, Type.Null()]),
    ...prompt,
    modelSelection: Type.Optional(
      Type.Object(
        {
          provider: id,
          modelId: id,
          thinkingLevel: Type.Optional(
            Type.Union(THINKING_LEVELS.map((value) => Type.Literal(value))),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    permissionMode: Type.Optional(Type.Union(PERMISSION_MODES.map((value) => Type.Literal(value)))),
  }),
  command("session.subscribe", session),
  command("session.unsubscribe", session),
  command("prompt", { ...session, ...prompt }),
  command("steer_now", { ...session, requestId: id }),
  command("withdraw", { ...session, requestId: id }),
  command("abort", session),
  command("session.pin", session),
  command("session.unpin", session),
  command("models.list", {}),
  command("session.set_model", {
    ...session,
    provider: id,
    modelId: id,
    thinkingLevel: Type.Optional(Type.Union(THINKING_LEVELS.map((value) => Type.Literal(value)))),
  }),
  command("session.set_permission_mode", {
    ...session,
    mode: Type.Union(PERMISSION_MODES.map((value) => Type.Literal(value))),
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
  | "session_busy"
  | "session_not_found"
  | "project_not_found"
  | "invalid_command"
  | "not_queued"
  | "interaction_stale"
  | "internal";
export type WireResponse<Result = unknown> = { type: "response"; id: string } & (
  | { result: Result; error?: never }
  | { error: { code: WireErrorCode; params?: Record<string, string | number> }; result?: never }
);
export interface WireProject {
  id: string;
  path: string;
  name: string;
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
      /** In-process idle close completed and its writer lease has been released. */
      closedSessionId?: string;
      sessions: WireSessionSummary[];
      projects: WireProject[];
      pinned: string[];
      preferences: WirePreferences;
    };
