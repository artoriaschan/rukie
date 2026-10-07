import { createContext, useContext, type ReactNode } from "react";
import { dark, type Theme } from "./theme";

const ThemeContext = createContext<Theme>(dark);

export function ThemeProvider({ theme = dark, children }: { theme?: Theme; children?: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
