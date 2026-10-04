/** Parameters are tied to each locale-independent, user-visible error code. */
export interface UserVisibleErrorParams {
  "allow-tools-retired": { source: string };
  "permission-rule-invalid": { source: string; rule: string };
  "ripgrep-unavailable": { cause: string };
  "no-model": { settings: string };
  "unknown-model": { model: string };
  "no-api-key": { provider: string; env: string };
  "session-not-found": { id: string };
  "hook-invalid-json": { cause: string };
  "hook-exit": { exitCode: string; stderr: string };
  "hook-timeout": { timeout: string };
  "hook-crashed": { signal: string };
  "hook-command-failed": { cause: string };
  "hook-type-unsupported": { type: string };
  "hook-matcher-invalid": { source: string; matcher: string };
  "hook-output-ignored": { field: string };
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
