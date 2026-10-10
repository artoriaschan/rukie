import type { ThemedToken, HighlighterCore } from "shiki/core";
const HIGHLIGHT_LIMIT = 12000;
const HIGHLIGHT_LINE_LIMIT = 200;
export const highlightThemes = { light: "github-light", dark: "github-dark" };
let shared: Promise<HighlighterCore> | undefined;
const cache = new Map<string, ThemedToken[][]>();
export function getHighlighter() {
  return (shared ??= import("./highlight-engine").then((module) => module.create()));
}
export function codeLanguage(language: string) {
  const aliases: Record<string, string> = {
    ts: "typescript",
    js: "javascript",
    sh: "bash",
    shell: "bash",
    py: "python",
    jsx: "tsx",
  };
  const name = aliases[language] ?? language;
  return [
    "typescript",
    "javascript",
    "tsx",
    "json",
    "bash",
    "python",
    "css",
    "html",
    "diff",
  ].includes(name)
    ? name
    : "text";
}
export function canHighlight(code: string) {
  return code.length <= HIGHLIGHT_LIMIT && code.split("\n").length <= HIGHLIGHT_LINE_LIMIT;
}
export async function highlight(code: string, language: string) {
  if (!canHighlight(code)) return null;
  const lang = codeLanguage(language),
    key = lang + "\0" + code;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const result = (await getHighlighter()).codeToTokens(code, {
    lang,
    themes: highlightThemes,
    defaultColor: false,
  }).tokens;
  cache.set(key, result);
  // At most 64 small complete blocks; streaming tails live in their mounted component only.
  while (cache.size > 64) cache.delete(cache.keys().next().value!);
  return result;
}
