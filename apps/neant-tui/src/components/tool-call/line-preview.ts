import type { SyntaxRun } from "@neant/tui";

/** Clip logical source lines before wrapping; the caller keeps the original for expansion. */
export function toolLinePreview(text: string) {
  if (text.length <= 1000) return { text, hidden: 0 };
  let end = 1000;
  const lead = text.charCodeAt(end - 1),
    trail = text.charCodeAt(end);
  if (lead >= 0xd800 && lead <= 0xdbff && trail >= 0xdc00 && trail <= 0xdfff) end--;
  return { text: text.slice(0, end), hidden: text.length - end };
}
/** Preserve the full-source lexer's colors while limiting painted text to the preview. */
export function previewSyntax(runs: readonly SyntaxRun[] | undefined, length: number) {
  let remaining = length;
  return runs?.flatMap((run) => {
    const text = run.text.slice(0, Math.max(0, remaining));
    remaining -= text.length;
    return text ? [{ ...run, text }] : [];
  });
}
