import { common, createI18n, type Locale } from "@rukie/i18n";
import { createContext, useContext, type ReactNode } from "react";
import { componentCopy } from "./component-copy";

const app: { zh: Record<string, string>; en: Record<string, string> } = componentCopy;
const translations = {
  zh: createI18n("zh", { common, app }),
  en: createI18n("en", { common, app }),
};
const UiLocaleContext = createContext<Locale>("en");

/** The app resolves locale and injects it as presentation data. */
export function UiLocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <UiLocaleContext.Provider value={locale}>{children}</UiLocaleContext.Provider>;
}

export type ComponentTranslator = (
  key: keyof typeof componentCopy.zh,
  params?: Record<string, string | number>,
) => string;

function componentTranslator(locale: Locale): ComponentTranslator {
  return translations[locale];
}

export function useComponentText(): ComponentTranslator {
  return componentTranslator(useContext(UiLocaleContext));
}
