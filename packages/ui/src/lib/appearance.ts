import type { DesktopHost } from "../host";

export type AppearancePreference = "system" | "light" | "dark";
const storageKey = "rukie.appearance";
export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

/** Renderer lifetime owner. Initialize before createRoot; dispose on renderer teardown. */
export function createAppearance(host?: Pick<DesktopHost, "setThemeSource">) {
  let raw: unknown;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    /* Storage may be unavailable. */
  }
  let preference: AppearancePreference = isAppearancePreference(raw) ? raw : "system";
  const media = matchMedia("(prefers-color-scheme: dark)");
  const listeners = new Set<() => void>();
  const apply = () => {
    const dark = preference === "dark" || (preference === "system" && media.matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };
  const changed = () => {
    if (preference === "system") apply();
  };
  media.addEventListener("change", changed);
  const sync = () => {
    // IPC sends enums in selection order. Native media updates are observed only in System mode.
    void host?.setThemeSource(preference).catch(() => {});
  };
  apply();
  sync();
  return {
    getSnapshot: () => preference,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPreference: (value: AppearancePreference) => {
      if (value === preference) return;
      preference = value;
      try {
        localStorage.setItem(storageKey, value);
      } catch {
        /* Keep the current page usable. */
      }
      apply();
      sync();
      for (const listener of listeners) listener();
    },
    dispose: () => {
      media.removeEventListener("change", changed);
      listeners.clear();
    },
  };
}
export type Appearance = ReturnType<typeof createAppearance>;
