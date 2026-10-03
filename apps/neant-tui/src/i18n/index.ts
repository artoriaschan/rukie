import { common, createI18n, type Locale } from "@neant/i18n";
import { appCopy } from "./locales";

/** Each frontend instance owns its fixed startup locale. */
export function createTuiI18n(
  locale: Locale,
): ReturnType<typeof createI18n<typeof common.zh, typeof appCopy.zh>> {
  return createI18n(locale, { common, app: appCopy });
}
