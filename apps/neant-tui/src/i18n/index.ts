import { common, createI18n, type Locale } from "@neant/i18n";
import type { UserVisibleErrorData } from "@neant/shared";
import { appCopy } from "./locales";

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
    [...template.matchAll(/\{\{([^{}]+)\}\}/g)].some(
      (match) => typeof (params as Record<string, unknown>)[match[1]!] !== "string",
    )
  )
    return message;
  const data = error as UserVisibleErrorData;
  switch (data.code) {
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
    case "session-not-found":
      return t("error.session-not-found", data.params);
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
    case "hook-config-invalid":
      return t("error.hook-config-invalid", data.params);
  }
}
