// Runtime-agnostic types and schemas shared across packages.
export type { JobView, JobOutput, JobEvent } from "./jobs.ts";
export { isUnknownToolOutcome } from "./tool-outcome.ts";
export {
  THINKING_LEVELS,
  PERMISSION_MODES,
  SettingsSchema,
  HOOK_EVENTS,
  HooksSchema,
  type HookEvent,
  type HookHandler,
  type HooksSettings,
  type Settings,
  type ThinkingLevel,
  type PermissionMode,
} from "./settings.ts";
export type {
  ContextUsageEvent,
  CustomSessionEvent,
  RunResult,
  SessionEvent,
} from "./events/index.ts";
export {
  createUserVisibleError,
  type UserVisibleErrorCode,
  type UserVisibleErrorParams,
  type UserVisibleErrorData,
} from "./errors.ts";

export type { ContextReport, ContextCategory } from "./context-report.ts";
export type { McpServerView, McpToolView, McpConfigError, McpSnapshot } from "./mcp.ts";

export {
  ToolCallViewSchema,
  ToolResultViewSchema,
  type ToolCallView,
  type ToolResultView,
  type ToolKind,
} from "./tool-view.ts";

export { ModelCompatSchemas } from "./model-compat.ts";
