import { createRoot } from "react-dom/client";
import { App } from "./app";
import { browserHost } from "./host";
import "./theme.css";
const host = window.rukieHost ?? browserHost();
const locale = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
document.documentElement.lang = locale;
const theme = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => {
  document.documentElement.classList.toggle("dark", theme.matches);
  document.documentElement.classList.toggle("light", !theme.matches);
};
applyTheme();
theme.addEventListener("change", applyTheme);
const root = document.getElementById("root");
if (root) createRoot(root).render(<App host={host} locale={locale} />);
