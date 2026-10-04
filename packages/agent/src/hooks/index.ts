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
import { parsePermissionRules } from "../permissions/index.ts";
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

interface StopHookResult extends CommonHookResult {
  decision?: "block";
  reason?: string;
}

type UserPromptSubmitResult = StopHookResult;
type SessionStartResult = CommonHookResult;

interface HookResults {
  PreToolUse: PreToolUseResult;
  UserPromptSubmit: UserPromptSubmitResult;
  SessionStart: SessionStartResult;
  Stop: StopHookResult;
}
type EventResult<E extends HookEvent> = E extends keyof HookResults
  ? HookResults[E]
  : CommonHookResult;

const truncate = (text: string) =>
  text.length > 10_000 ? `${text.slice(0, 10_000)}\n[truncated]` : text;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  projectDir: string;
  onWarning(warning: string): void;
  onEvent(event: CustomSessionEvent): void | Promise<void>;
}) {
  validateHooks(options.settings, "settings");
  const settings = mergeHooks(options.settings);
  const lifetime = new AbortController();
  return {
    /** Cancels Session-owned hook work; SessionEnd has its own shutdown budget. */
    dispose: () => lifetime.abort(),
    async run<E extends HookEvent>(
      event: E,
      input: HookInput,
      runOptions: { signal?: AbortSignal; matchQuery?: string } = {},
    ): Promise<EventResult<E>> {
      const result: PreToolUseResult & UserPromptSubmitResult & StopHookResult = {
        systemMessages: [],
        additionalContext: [],
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
          const key = handlerKey(handler);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      await Promise.all(
        handlers.map(async (handler) => {
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
              signal,
              timeout: handler.timeout ?? (event === "UserPromptSubmit" ? 30 : 600),
            });
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
            const commonFields: Record<string, string> = {
              continue: "boolean",
              stopReason: "string",
              systemMessage: "string",
              suppressOutput: "boolean",
              reason: "string",
              ...((event === "UserPromptSubmit" || event === "Stop") && { decision: "string" }),
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
            const specific = object(json.hookSpecificOutput) ? { ...json.hookSpecificOutput } : {};
            const specificFields = new Set(
              event === "PreToolUse"
                ? [
                    "hookEventName",
                    "permissionDecision",
                    "permissionDecisionReason",
                    "updatedInput",
                    "additionalContext",
                  ]
                : ["hookEventName", "additionalContext"],
            );
            for (const [field, value] of Object.entries(specific)) {
              const valid =
                specificFields.has(field) &&
                (field === "updatedInput" ||
                  (field === "permissionDecision"
                    ? typeof value === "string" && ["allow", "ask", "deny"].includes(value)
                    : typeof value === "string"));
              if (!valid) {
                await ignored(`hookSpecificOutput.${field}`);
                delete specific[field];
              }
            }
            if (specific.hookEventName !== undefined && specific.hookEventName !== event) {
              await ignored("hookSpecificOutput.hookEventName");
              for (const field of Object.keys(specific)) delete specific[field];
            }
            if (json.continue === false) {
              result.continue = false;
              if (typeof json.stopReason === "string")
                result.stopReason = truncate(json.stopReason);
            }
            if (typeof json.systemMessage === "string") {
              const message = truncate(json.systemMessage);
              result.systemMessages.push(message);
              await options.onEvent({ type: "hook_message", event, message });
            }
            if (typeof specific.additionalContext === "string")
              result.additionalContext.push(truncate(specific.additionalContext));
            if (event === "UserPromptSubmit" || event === "SessionStart") {
              if (output.exitCode === 0 && stdout && !jsonOutput)
                result.additionalContext.push(truncate(stdout));
            }
            if (event === "UserPromptSubmit" || event === "Stop") {
              if (json.decision !== undefined && json.decision !== "block")
                await ignored("decision");
              if (output.exitCode === 2 || json.decision === "block") {
                result.decision = "block";
                const reason = typeof json.reason === "string" ? json.reason : output.stderr.trim();
                result.reason = [result.reason, reason].filter(Boolean).join("\n") || undefined;
              }
            }
            if (event !== "PreToolUse") return;
            const decision = output.exitCode === 2 ? "deny" : specific.permissionDecision;
            if (decision === "allow" || decision === "ask" || decision === "deny") {
              const rank = { allow: 1, ask: 2, deny: 3 };
              if (!result.permissionDecision || rank[decision] >= rank[result.permissionDecision]) {
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
                  [result.permissionDecisionReason, reason].filter(Boolean).join("\n") || undefined;
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
            if (!signal.aborted || (event === "SessionEnd" && !runOptions.signal?.aborted)) {
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
        }),
      ).finally(() => clearTimeout(timer));
      return result as EventResult<E>;
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

export function validateHooks(settings: HooksSettings | undefined, source: string): void {
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
        if (handler.if !== undefined)
          parsePermissionRules({ deny: [handler.if] }, `${path}/hooks/${handlerIndex}/if`);
    }
}
