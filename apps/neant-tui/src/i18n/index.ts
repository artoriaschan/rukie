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
    case "session-not-found":
      return t("error.session-not-found", data.params);
    case "ripgrep-unavailable":
      return t("error.ripgrep-unavailable", data.params);
  }
}
