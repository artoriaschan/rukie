import { common, createI18n, type Locale } from "@neant/i18n";

/** Each frontend instance owns its fixed startup locale. App copy grows in later tickets. */
export function createTuiI18n(locale: Locale): ReturnType<typeof createI18n<typeof common.zh, {}>> {
  return createI18n(locale, { common, app: { zh: {}, en: {} } });
}
