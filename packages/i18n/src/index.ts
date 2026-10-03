export { common } from "./common";

export const SUPPORTED_LOCALES = ["zh", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

type Placeholders<Text extends string> = Text extends `${string}{{${infer Name}}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/** App keys cannot redefine concepts owned by the common dictionary. */
export function createI18n<
  const Common extends Record<string, string>,
  const App extends Record<string, string>,
>(
  locale: Locale,
  dictionaries: {
    common: { zh: Common; en: Record<keyof Common, string> };
    app: {
      zh: App & Record<Extract<keyof App, keyof Common>, never>;
      en: Record<keyof App, string> & Partial<Record<keyof Common, never>>;
    };
  },
) {
  const messages: Record<string, string> = {
    ...dictionaries.common[locale],
    ...dictionaries.app[locale],
  };
  return function t<Key extends keyof (Common & App) & string>(
    key: Key,
    ...args: [Placeholders<(Common & App)[Key]>] extends [never]
      ? [params?: Record<string, string | number>]
      : [params: Record<Placeholders<(Common & App)[Key]>, string | number>]
  ): string {
    if (!Object.hasOwn(messages, key)) return key;
    const text = messages[key]!;
    const params: Record<string, string | number> = args[0] ?? {};
    return text.replace(/\{\{([^{}]+)\}\}/g, (placeholder, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder,
    );
  };
}

/** Candidates are supplied by the frontend, in preference order. */
export function resolveLocale(candidates: (string | undefined)[]): Locale {
  for (const candidate of candidates) {
    const language = candidate
      ?.trim()
      .toLowerCase()
      .split(/[-_.@]/)[0];
    if (SUPPORTED_LOCALES.some((locale) => locale === language)) return language as Locale;
  }
  return "en";
}

/** Chinese retains the existing compact TUI format; English separates compound units. */
export function fmtDuration(ms: number, locale: Locale): string {
  if (ms < 1000) return "0s";
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60)
    return locale === "zh"
      ? `${minutes}m${seconds}s`
      : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return locale === "zh"
    ? `${hours}h${minutes % 60}m`
    : `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
