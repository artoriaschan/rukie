import { common, createI18n, type Locale } from "@neant/i18n";
import type { UserVisibleErrorData } from "@neant/shared";
import { appCopy } from "../../view/i18n/locales";

/** Each frontend instance owns its fixed startup locale. */
export function createTuiI18n(
  locale: Locale,
): ReturnType<typeof createI18n<typeof common.zh, typeof appCopy.zh>> {
  return createI18n(locale, { common, app: appCopy });
}

/** Coded errors are frontend copy; unknown failures keep their original information. */
export function formatError(error: unknown, t: ReturnType<typeof createTuiI18n>): string {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : String(error);
  if (typeof error !== "object" || error === null || !("code" in error) || !("params" in error))
    return message;
  const key = `error.${String(error.code)}`;
  if (!Object.hasOwn(common.zh, key) || typeof error.params !== "object" || error.params === null)
    return message;
  const template = common.zh[key as keyof typeof common.zh];
  const params = error.params;
  if (
    [...template.matchAll(/\{\{([^{}]+)\}\}/g)].some((match) => {
      const value = (params as Record<string, unknown>)[match[1]!];
      return typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value));
    })
  )
    return message;
  const data = error as UserVisibleErrorData;
  switch (data.code) {
    case "image-invalid":
      return t("error.image-invalid", data.params);
    case "image-too-large":
      return t("error.image-too-large", data.params);
    case "image-dimensions":
      return t("error.image-dimensions", data.params);
    case "image-mime-mismatch":
      return t("error.image-mime-mismatch", data.params);
    case "allow-tools-retired":
      return t("error.allow-tools-retired", data.params);
    case "permission-rule-invalid":
      return t("error.permission-rule-invalid", data.params);
    case "no-model":
      return t("error.no-model", data.params);
    case "unknown-model":
      return t("error.unknown-model", data.params);
    case "no-api-key":
      return t("error.no-api-key", {
        ...data.params,
        env: data.params.env || t("api-key.environment-default"),
      });
    case "compaction-no-history":
      return t("error.compaction-no-history", data.params);
    case "side-question-empty":
      return t("error.side-question-empty", data.params);
    case "side-question-failed":
      return t("error.side-question-failed", data.params);
    case "side-question-provider-failed":
      return t("error.side-question-provider-failed", data.params);
    case "side-question-no-response":
      return t("error.side-question-no-response", data.params);
    case "session-title-empty":
      return t("error.session-title-empty", data.params);
    case "model-switch-busy":
      return t("error.model-switch-busy", data.params);
    case "session-run-active":
      return t("error.session-run-active", data.params);
    case "session-rewinding":
      return t("error.session-rewinding", data.params);
    case "session-compacting":
      return t("error.session-compacting", data.params);
    case "session-switching-models":
      return t("error.session-switching-models", data.params);
    case "mcp-unknown-server":
      return t("error.mcp-unknown-server", data.params);
    case "mcp-auth-http-required":
      return t("error.mcp-auth-http-required", data.params);
    case "mcp-auth-callback-required":
      return t("error.mcp-auth-callback-required", data.params);
    case "mcp-auth-unavailable":
      return t("error.mcp-auth-unavailable", data.params);
    case "mcp-connection-closed":
      return t("error.mcp-connection-closed", data.params);
    case "mcp-connection-lost":
      return t("error.mcp-connection-lost", data.params);
    case "mcp-auth-url-missing":
      return t("error.mcp-auth-url-missing", data.params);
    case "mcp-auth-callback-invalid":
      return t("error.mcp-auth-callback-invalid", data.params);
    case "mcp-auth-code-missing":
      return t("error.mcp-auth-code-missing", data.params);
    case "mcp-auth-metadata-status":
      return t("error.mcp-auth-metadata-status", data.params);
    case "mcp-auth-metadata-invalid":
      return t("error.mcp-auth-metadata-invalid", data.params);
    case "mcp-auth-endpoint-invalid":
      return t("error.mcp-auth-endpoint-invalid", data.params);
    case "mcp-env-missing":
      return t("error.mcp-env-missing", data.params);
    case "mcp-config-invalid":
      return t("error.mcp-config-invalid", data.params);
    case "mcp-config-metadata-https":
      return t("error.mcp-config-metadata-https", data.params);
    case "mcp-config-file-invalid":
      return t("error.mcp-config-file-invalid", data.params);
    case "mcp-auth-state-mismatch":
      return t("error.mcp-auth-state-mismatch", data.params);
    case "session-mcp-busy":
      return t("error.session-mcp-busy", data.params);
    case "compaction-hook-stopped":
      return t("error.compaction-hook-stopped", data.params);
    case "compaction-hook-stopped-reason":
      return t("error.compaction-hook-stopped-reason", data.params);
    case "session-not-found":
      return t("error.session-not-found", data.params);
    case "session-observation-readonly":
      return t("error.session-observation-readonly", data.params);
    case "background-job-limit":
      return t("error.background-job-limit", data.params);
    case "ripgrep-unavailable":
      return t("error.ripgrep-unavailable", data.params);
    case "hook-invalid-json":
      return t("error.hook-invalid-json", data.params);
    case "hook-exit":
      return t("error.hook-exit", data.params);
    case "hook-mcp-unconnected":
      return t("error.hook-mcp-unconnected", data.params);
    case "hook-mcp-failed":
      return t("error.hook-mcp-failed", data.params);
    case "hook-http-status":
      return t("error.hook-http-status", data.params);
    case "hook-timeout":
      return t("error.hook-timeout", data.params);
    case "hook-crashed":
      return t("error.hook-crashed", data.params);
    case "hook-execution-failed":
      return t("error.hook-execution-failed", data.params);
    case "hook-model-failed":
      return t("error.hook-model-failed", data.params);
    case "hook-command-failed":
      return t("error.hook-command-failed", data.params);
    case "hook-type-unsupported":
      return t("error.hook-type-unsupported", data.params);
    case "hook-matcher-invalid":
      return t("error.hook-matcher-invalid", data.params);
    case "hook-if-nontool":
      return t("error.hook-if-nontool", data.params);
    case "hook-output-ignored":
      return t("error.hook-output-ignored", data.params);
    case "hook-compaction-blocked":
      return t("error.hook-compaction-blocked", data.params);
    case "hook-continuation-limit":
      return t("error.hook-continuation-limit", data.params);
    case "hook-project-untrusted":
      return t("error.hook-project-untrusted", data.params);
    case "goal-tool-human-required":
      return t("error.goal-tool-human-required", data.params);
    case "goal-tool-completion-authority":
      return t("error.goal-tool-completion-authority", data.params);
    case "goal-tool-invalid-argument":
      return t("error.goal-tool-invalid-argument", data.params);
    case "goal-tool-required-argument":
      return t("error.goal-tool-required-argument", data.params);
    case "goal-tool-resume-paused":
      return t("error.goal-tool-resume-paused", data.params);
    case "goal-child-session":
      return t("error.goal-child-session", data.params);
    case "goal-busy":
      return t("error.goal-busy", data.params);
    case "goal-objective-empty":
      return t("error.goal-objective-empty", data.params);
    case "goal-rounds-invalid":
      return t("error.goal-rounds-invalid", data.params);
    case "goal-exists":
      return t("error.goal-exists", data.params);
    case "goal-missing":
      return t("error.goal-missing", data.params);
    case "goal-pause-invalid":
      return t("error.goal-pause-invalid", data.params);
    case "goal-complete":
      return t("error.goal-complete", data.params);
    case "goal-already-armed":
      return t("error.goal-already-armed", data.params);
    case "goal-round-limit":
      return t("error.goal-round-limit", data.params);
    case "hook-config-invalid":
      return t("error.hook-config-invalid", data.params);
  }
}
