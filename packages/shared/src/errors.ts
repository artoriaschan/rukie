/** Parameters are tied to each locale-independent, user-visible error code. */
export interface UserVisibleErrorParams {
  "image-invalid": Record<string, never>;
  "image-too-large": { maxBytes: number };
  "image-dimensions": { width: number; height: number; maxPixels: number };
  "image-mime-mismatch": { mimeType: string };
  "allow-tools-retired": { source: string };
  "permission-rule-invalid": { source: string; rule: string };
  "background-job-limit": { limit: number };
  "ripgrep-unavailable": { cause: string };
  "no-model": { settings: string };
  "unknown-model": { model: string };
  "no-api-key": { provider: string; env: string };
  "session-not-found": { id: string };
  "session-observation-readonly": Record<string, never>;
  "compaction-no-history": Record<string, never>;
  "side-question-empty": Record<string, never>;
  "side-question-failed": Record<string, never>;
  "side-question-provider-failed": { cause: string };
  "side-question-no-response": Record<string, never>;
  "session-title-empty": Record<string, never>;
  "model-switch-busy": Record<string, never>;
  "session-run-active": Record<string, never>;
  "session-rewinding": Record<string, never>;
  "session-compacting": Record<string, never>;
  "session-switching-models": Record<string, never>;
  "compaction-hook-stopped": Record<string, never>;
  "compaction-hook-stopped-reason": { reason: string };
  "hook-invalid-json": { cause: string };
  "hook-exit": { exitCode: string; stderr: string };
  "hook-mcp-unconnected": { server: string };
  "hook-mcp-failed": { server: string; tool: string };
  "hook-http-status": { status: string };
  "hook-timeout": { timeout: string };
  "hook-crashed": { signal: string };
  "hook-execution-failed": { cause: string };
  "hook-command-failed": { cause: string };
  "hook-model-failed": { cause: string };
  "hook-type-unsupported": { type: string };
  "hook-matcher-invalid": { source: string; matcher: string };
  "hook-if-nontool": { source: string; event: string };
  "hook-output-ignored": { field: string };
  "hook-compaction-blocked": { reason: string };
  "hook-continuation-limit": { event: string; limit: string };
  "hook-project-untrusted": { source: string };
  "goal-tool-human-required": Record<string, never>;
  "goal-tool-completion-authority": Record<string, never>;
  "goal-tool-invalid-argument": { field: string; action: string };
  "goal-tool-required-argument": { field: string; action: string };
  "goal-tool-resume-paused": Record<string, never>;
  "goal-child-session": Record<string, never>;
  "goal-busy": Record<string, never>;
  "goal-objective-empty": Record<string, never>;
  "goal-rounds-invalid": Record<string, never>;
  "goal-exists": Record<string, never>;
  "goal-missing": Record<string, never>;
  "goal-pause-invalid": Record<string, never>;
  "goal-complete": Record<string, never>;
  "goal-already-armed": Record<string, never>;
  "goal-round-limit": Record<string, never>;
  "hook-config-invalid": { source: string; cause: string };
}

export type UserVisibleErrorCode = keyof UserVisibleErrorParams;
export type UserVisibleErrorData = {
  [Code in UserVisibleErrorCode]: { code: Code; params: UserVisibleErrorParams[Code] };
}[UserVisibleErrorCode];

/** The English message is useful to headless callers; frontends translate the data. */
export function createUserVisibleError(
  message: string,
  data: UserVisibleErrorData,
  options?: ErrorOptions,
): Error & UserVisibleErrorData {
  return Object.assign(new Error(message, options), data);
}
