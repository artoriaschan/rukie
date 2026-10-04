import {
  HOOK_EVENTS,
  createUserVisibleError,
  type CustomSessionEvent,
  type HookEvent,
  type HookHandler,
  type HooksSettings,
  type PermissionMode,
  type UserVisibleErrorData,
} from "@neant/shared";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { evaluatePermissionRules, parsePermissionRules } from "../permissions/index.ts";
import { executeCommand } from "./command.ts";

export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: PermissionMode;
  agent_id?: string;
  agent_type?: string;
  [field: string]: unknown;
}

export interface CommonHookResult {
  continue?: false;
  stopReason?: string;
  systemMessages: string[];
  additionalContext: string[];
}

export interface PreToolUseResult extends CommonHookResult {
  permissionDecision?: "allow" | "ask" | "deny";
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;
  hook?: string;
}

export interface PermissionRequestResult extends CommonHookResult {
  decision?:
    | { behavior: "allow"; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
    | { behavior: "deny"; message?: string; interrupt?: boolean };
  hook?: string;
}

export interface PermissionDeniedResult extends CommonHookResult {
  retry?: true;
}

interface StopHookResult extends CommonHookResult {
  decision?: "block";
  reason?: string;
}

interface PostToolUseResult extends StopHookResult {
  updatedToolOutput?: ToolResultMessage["content"];
}

type UserPromptSubmitResult = StopHookResult;
type SessionStartResult = CommonHookResult;

interface HookResults {
  PreToolUse: PreToolUseResult;
  PostToolUse: PostToolUseResult;
  PermissionRequest: PermissionRequestResult;
  PermissionDenied: PermissionDeniedResult;
  UserPromptSubmit: UserPromptSubmitResult;
  SessionStart: SessionStartResult;
  Stop: StopHookResult;
  PreCompact: StopHookResult;
  SubagentStop: StopHookResult;
}
type EventResult<E extends HookEvent> = E extends keyof HookResults
  ? HookResults[E]
  : CommonHookResult;

const truncate = (text: string) =>
  text.length > 10_000 ? `${text.slice(0, 10_000)}\n[truncated]` : text;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const toolEvents = new Set<HookEvent>([
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
]);

function validToolContent(value: unknown): value is ToolResultMessage["content"] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        object(item) &&
        (item.type === "text"
          ? typeof item.text === "string" &&
            (item.textSignature === undefined || typeof item.textSignature === "string")
          : item.type === "image" &&
            typeof item.data === "string" &&
            typeof item.mimeType === "string"),
    )
  );
}

function matches(matcher: string | undefined, query: string): boolean {
  if (!matcher || matcher === "*") return true;
  return /^[A-Za-z0-9_|,]+$/.test(matcher)
    ? matcher.split(/[|,]/).includes(query)
    : new RegExp(matcher).test(query);
}

/** Session supplies lifecycle inputs; this runner owns protocol execution and result merging. */
export function createHooks(options: {
  settings?: HooksSettings;
  cwd: string;
  homeDir: string;
  projectDir: string;
  onWarning(warning: string): void;
  onEvent(event: CustomSessionEvent): void | Promise<void>;
  onAsyncResult?(result: CommonHookResult, rewakeReason?: string): void;
}) {
  validateHooks(options.settings, "settings", (warning) => {
    options.onWarning(`${warning.event} hook ${warning.hook}: ${warning.message}`);
    void Promise.resolve(options.onEvent(warning)).catch(() => {});
  });
  const settings = mergeHooks(options.settings);
  const filters = new Map<HookHandler, ReturnType<typeof parsePermissionRules>>();
  for (const groups of Object.values(settings))
    for (const group of groups)
      for (const handler of group.hooks)
        if (handler.if !== undefined)
          filters.set(handler, parsePermissionRules({ deny: [handler.if] }));
  const lifetime = new AbortController();
  return {
    /** Cancels Session-owned hook work; SessionEnd has its own shutdown budget. */
    dispose: () => lifetime.abort(),
    async run<E extends HookEvent>(
      event: E,
      input: HookInput,
      runOptions: { signal?: AbortSignal; matchQuery?: string } = {},
    ): Promise<EventResult<E>> {
      const mergedResult: PreToolUseResult &
        UserPromptSubmitResult &
        StopHookResult &
        PermissionDeniedResult &
        PostToolUseResult = {
        systemMessages: [],
        additionalContext: [],
      };
      let requestDecision: PermissionRequestResult["decision"];
      let requestHook: string | undefined;
      const denyRequest = (message: string | undefined, interrupt: boolean, hook: string) => {
        const prior = requestDecision?.behavior === "deny" ? requestDecision : undefined;
        requestDecision = {
          behavior: "deny",
          message: [prior?.message, message].filter(Boolean).join("\n") || undefined,
          interrupt: prior?.interrupt || interrupt,
        };
        requestHook = hook;
      };
      const shutdown = event === "SessionEnd" ? new AbortController() : undefined;
      const timer = shutdown ? setTimeout(() => shutdown.abort(), 1500) : undefined;
      const signal = AbortSignal.any([
        ...(runOptions.signal ? [runOptions.signal] : []),
        shutdown?.signal ?? lifetime.signal,
      ]);
      const snapshot = structuredClone({ ...input, hook_event_name: event });
      const seen = new Set<string>();
      const handlers = (settings[event] ?? [])
        .filter(
          (group) =>
            event === "Stop" ||
            event === "UserPromptSubmit" ||
            matches(group.matcher, runOptions.matchQuery ?? ""),
        )
        .flatMap((group) => group.hooks)
        .filter((handler) => {
          if (handler.if === undefined) return true;
          if (!toolEvents.has(event) || typeof input.tool_name !== "string") return false;
          return (
            evaluatePermissionRules({
              rules: filters.get(handler)!,
              toolName: input.tool_name,
              args: input.tool_input,
              cwd: options.cwd,
              homeDir: options.homeDir,
            }) !== undefined
          );
        })
        .filter((handler) => {
          const key = handlerKey(handler);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const isBackground = (handler: HookHandler) =>
        event !== "SessionEnd" &&
        handler.type === "command" &&
        (handler.async || handler.asyncRewake);
      await Promise.all(
        handlers
          .map(async (handler) => {
            const background = isBackground(handler);
            const result: typeof mergedResult = background
              ? { systemMessages: [], additionalContext: [] }
              : mergedResult;
            let rewakeReason: string | undefined;
            const executionSignal = background ? lifetime.signal : signal;
            const hook = handler.type === "command" ? handler.command : handler.type;
            const warn = async (warning: string, error: UserVisibleErrorData) => {
              options.onWarning(`${event} hook ${hook}: ${warning}`);
              const notification: CustomSessionEvent = {
                type: "hook_warning",
                event,
                hook,
                message: warning,
                error,
              };
              // Shutdown may be called by an event observer awaiting dispose itself.
              if (event === "SessionEnd") {
                try {
                  void Promise.resolve(options.onEvent(notification)).catch(() => {});
                } catch {
                  /* Observers cannot hold shutdown open or turn diagnostics into failure. */
                }
              } else await options.onEvent(notification);
            };
            try {
              if (handler.type !== "command") {
                await warn(`Unsupported hook type: ${handler.type}`, {
                  code: "hook-type-unsupported",
                  params: { type: handler.type },
                });
                return;
              }
              const output = await executeCommand(handler, snapshot, {
                cwd: options.cwd,
                projectDir: options.projectDir,
                signal: executionSignal,
                timeout: background
                  ? undefined
                  : (handler.timeout ?? (event === "UserPromptSubmit" ? 30 : 600)),
              });
              if (handler.asyncRewake && output.exitCode === 2) rewakeReason = output.stderr.trim();
              const warnExit = async () => {
                if (output.exitCode !== 0 && output.exitCode !== 2)
                  await warn(
                    `Hook exited with code ${output.exitCode}${output.stderr.trim() ? `: ${output.stderr.trim()}` : ""}`,
                    {
                      code: "hook-exit",
                      params: { exitCode: String(output.exitCode), stderr: output.stderr.trim() },
                    },
                  );
              };
              // Shutdown hooks are only for side effects: even valid control output is discarded.
              if (event === "SessionEnd") {
                await warnExit();
                return;
              }
              let json: Record<string, unknown> = {};
              const stdout = output.stdout.trim();
              const jsonOutput = stdout.startsWith("{") && stdout.endsWith("}");
              if (jsonOutput) {
                try {
                  const parsed: unknown = JSON.parse(stdout);
                  if (!object(parsed)) throw new Error("Hook output must be a JSON object");
                  json = parsed;
                } catch (error) {
                  await warn(`Invalid hook JSON: ${(error as Error).message}`, {
                    code: "hook-invalid-json",
                    params: { cause: (error as Error).message },
                  });
                  if (output.exitCode !== 2) return;
                }
              }
              await warnExit();
              const ignored = (field: string) =>
                warn(`Ignoring invalid or unsupported hook output field: ${field}`, {
                  code: "hook-output-ignored",
                  params: { field },
                });
              const supportsBlockingDecision =
                event === "UserPromptSubmit" ||
                event === "Stop" ||
                event === "PreCompact" ||
                event === "SubagentStop" ||
                event === "PostToolUse";
              const commonFields: Record<string, string> = {
                continue: "boolean",
                stopReason: "string",
                systemMessage: "string",
                suppressOutput: "boolean",
                reason: "string",
                ...(supportsBlockingDecision && {
                  decision: "string",
                }),
              };
              for (const [field, value] of Object.entries(json)) {
                if (field === "hookSpecificOutput") {
                  if (!object(value)) await ignored(field);
                } else if (
                  !Object.hasOwn(commonFields, field) ||
                  typeof value !== commonFields[field]
                ) {
                  await ignored(field);
                  delete json[field];
                }
              }
              const specific = object(json.hookSpecificOutput)
                ? { ...json.hookSpecificOutput }
                : {};
              const specificFields = new Set(
                event === "PreToolUse"
                  ? [
                      "hookEventName",
                      "permissionDecision",
                      "permissionDecisionReason",
                      "updatedInput",
                      "additionalContext",
                    ]
                  : event === "PermissionRequest"
                    ? ["hookEventName", "decision", "additionalContext"]
                    : event === "PermissionDenied"
                      ? ["hookEventName", "retry", "additionalContext"]
                      : event === "PostToolUse"
                        ? ["hookEventName", "additionalContext", "updatedToolOutput"]
                        : ["hookEventName", "additionalContext"],
              );
              for (const [field, value] of Object.entries(specific)) {
                const valid =
                  specificFields.has(field) &&
                  (field === "updatedToolOutput"
                    ? validToolContent(value)
                    : field === "updatedInput"
                      ? true
                      : field === "decision"
                        ? object(value)
                        : field === "retry"
                          ? typeof value === "boolean"
                          : field === "permissionDecision"
                            ? typeof value === "string" && ["allow", "ask", "deny"].includes(value)
                            : typeof value === "string");
                if (!valid) {
                  await ignored(`hookSpecificOutput.${field}`);
                  delete specific[field];
                }
              }
              if (specific.hookEventName !== undefined && specific.hookEventName !== event) {
                await ignored("hookSpecificOutput.hookEventName");
                for (const field of Object.keys(specific)) delete specific[field];
              }
              if (!background && json.continue === false) {
                result.continue = false;
                if (typeof json.stopReason === "string")
                  result.stopReason = truncate(json.stopReason);
              }
              if (typeof json.systemMessage === "string") {
                const message = truncate(json.systemMessage);
                result.systemMessages.push(message);
              }
              if (typeof specific.additionalContext === "string")
                result.additionalContext.push(truncate(specific.additionalContext));
              if (event === "UserPromptSubmit" || event === "SessionStart") {
                if (output.exitCode === 0 && stdout && !jsonOutput)
                  result.additionalContext.push(truncate(stdout));
              }
              if (background && !lifetime.signal.aborted)
                options.onAsyncResult?.(result, rewakeReason);
              if (typeof json.systemMessage === "string")
                await options.onEvent({
                  type: "hook_message",
                  event,
                  message: truncate(json.systemMessage),
                });
              if (background) return;
              if (supportsBlockingDecision) {
                if (json.decision !== undefined && json.decision !== "block")
                  await ignored("decision");
                if (output.exitCode === 2 || json.decision === "block") {
                  result.decision = "block";
                  const reason =
                    typeof json.reason === "string" ? json.reason : output.stderr.trim();
                  result.reason = [result.reason, reason].filter(Boolean).join("\n") || undefined;
                }
              }
              if (
                (event === "PermissionRequest" || event === "PermissionDenied") &&
                output.exitCode === 2
              )
                return;
              if (event === "PermissionRequest") {
                if (object(specific.decision)) {
                  const decision = specific.decision;
                  if (decision.behavior !== "allow" && decision.behavior !== "deny") {
                    await ignored("hookSpecificOutput.decision.behavior");
                    return;
                  }
                  const allowed =
                    decision.behavior === "allow"
                      ? ["behavior", "updatedInput", "updatedPermissions"]
                      : ["behavior", "message", "interrupt"];
                  for (const field of Object.keys(decision)) {
                    const valid =
                      allowed.includes(field) &&
                      (field === "behavior" ||
                        field === "updatedInput" ||
                        (field === "updatedPermissions"
                          ? Array.isArray(decision[field])
                          : field === "interrupt"
                            ? typeof decision[field] === "boolean"
                            : typeof decision[field] === "string"));
                    if (!valid) {
                      await ignored(`hookSpecificOutput.decision.${field}`);
                      delete decision[field];
                    }
                  }
                  if (
                    decision.behavior === "allow" &&
                    decision.updatedInput !== undefined &&
                    !object(decision.updatedInput)
                  ) {
                    denyRequest(
                      "Denied by hook: invalid updatedInput: expected an object",
                      false,
                      hook,
                    );
                  } else if (
                    decision.behavior === "deny" ||
                    !requestDecision ||
                    requestDecision.behavior === "allow"
                  ) {
                    if (decision.behavior === "deny") {
                      denyRequest(
                        typeof decision.message === "string" ? decision.message : undefined,
                        decision.interrupt === true,
                        hook,
                      );
                    } else requestDecision = decision as PermissionRequestResult["decision"];
                    requestHook = hook;
                  }
                }
                return;
              }
              if (event === "PermissionDenied") {
                if (specific.retry === true && input.by === "review") result.retry = true;
                return;
              }
              if (event === "PostToolUse" && validToolContent(specific.updatedToolOutput))
                result.updatedToolOutput = specific.updatedToolOutput;
              if (event !== "PreToolUse") return;
              const decision = output.exitCode === 2 ? "deny" : specific.permissionDecision;
              if (decision === "allow" || decision === "ask" || decision === "deny") {
                const rank = { allow: 1, ask: 2, deny: 3 };
                if (
                  !result.permissionDecision ||
                  rank[decision] >= rank[result.permissionDecision]
                ) {
                  result.permissionDecision = decision;
                  result.hook = hook;
                  const reason =
                    output.exitCode === 2
                      ? typeof json.reason === "string"
                        ? json.reason
                        : output.stderr.trim()
                      : typeof specific.permissionDecisionReason === "string"
                        ? specific.permissionDecisionReason
                        : undefined;
                  result.permissionDecisionReason =
                    [result.permissionDecisionReason, reason].filter(Boolean).join("\n") ||
                    undefined;
                }
              }
              if (specific.updatedInput !== undefined) {
                if (!object(specific.updatedInput)) {
                  result.permissionDecision = "deny";
                  result.permissionDecisionReason = "Invalid updatedInput: expected an object";
                  result.hook = hook;
                } else {
                  result.updatedInput = specific.updatedInput;
                  result.hook ??= hook;
                }
              }
            } catch (error) {
              if (
                !executionSignal.aborted ||
                (event === "SessionEnd" && !runOptions.signal?.aborted)
              ) {
                const budgetExpired = shutdown?.signal.aborted;
                const data = budgetExpired
                  ? { code: "hook-timeout" as const, params: { timeout: "1.5" } }
                  : error instanceof Error && "code" in error && "params" in error
                    ? (error as Error & UserVisibleErrorData)
                    : {
                        code: "hook-command-failed" as const,
                        params: { cause: (error as Error).message },
                      };
                await warn(
                  budgetExpired
                    ? "Hook timed out after 1.5s (SessionEnd budget)"
                    : (error as Error).message,
                  data,
                );
              }
            }
          })
          .map((completion, index) => {
            if (isBackground(handlers[index]!)) {
              void completion.catch(() => {});
              return;
            }
            return completion;
          }),
      ).finally(() => clearTimeout(timer));
      return (
        event === "PermissionRequest"
          ? { ...mergedResult, decision: requestDecision, hook: requestHook }
          : mergedResult
      ) as EventResult<E>;
    },
  };
}

function handlerKey(handler: HookHandler): string {
  switch (handler.type) {
    case "command":
      return JSON.stringify([
        handler.type,
        handler.shell,
        handler.command,
        handler.args,
        handler.if,
      ]);
    case "http":
      return JSON.stringify([handler.type, handler.url, handler.if]);
    case "mcp_tool":
      return JSON.stringify([
        handler.type,
        handler.server,
        handler.tool,
        handler.input,
        handler.if,
      ]);
    case "prompt":
    case "agent":
      return JSON.stringify([handler.type, handler.prompt, handler.model, handler.if]);
  }
}

/** Merge configurations in execution order, retaining the first identical handler per event/matcher. */
export function mergeHooks(...layers: (HooksSettings | undefined)[]): HooksSettings {
  const merged: HooksSettings = {};
  for (const event of HOOK_EVENTS) {
    const seen = new Set<string>();
    for (const layer of layers)
      for (const group of layer?.[event] ?? []) {
        const hooks = group.hooks.filter((handler) => {
          const key = JSON.stringify([
            !group.matcher || group.matcher === "*" ? "*" : group.matcher,
            handlerKey(handler),
          ]);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (hooks.length) (merged[event] ??= []).push({ ...group, hooks });
      }
  }
  return merged;
}

export function validateHooks(
  settings: HooksSettings | undefined,
  source: string,
  onWarning?: (warning: Extract<CustomSessionEvent, { type: "hook_warning" }>) => void,
): void {
  for (const event of HOOK_EVENTS)
    for (const [index, group] of (settings?.[event] ?? []).entries()) {
      const path = `${source}: /hooks/${event}/${index}`;
      const matcher = group.matcher;
      if (matcher && matcher !== "*" && !/^[A-Za-z0-9_|,]+$/.test(matcher)) {
        try {
          new RegExp(matcher);
        } catch {
          throw createUserVisibleError(`${path}/matcher invalid regular expression: ${matcher}`, {
            code: "hook-matcher-invalid",
            params: { source: `${path}/matcher`, matcher },
          });
        }
      }
      for (const [handlerIndex, handler] of group.hooks.entries())
        if (handler.if !== undefined) {
          const location = `${path}/hooks/${handlerIndex}/if`;
          parsePermissionRules({ deny: [handler.if] }, location);
          if (!toolEvents.has(event))
            onWarning?.({
              type: "hook_warning",
              event,
              hook: handler.type === "command" ? handler.command : handler.type,
              message: `${location}: if is only supported on tool events; this ${event} hook will never run.`,
              error: { code: "hook-if-nontool", params: { source: location, event } },
            });
        }
    }
}
