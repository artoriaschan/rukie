import hljs from "highlight.js";
import { ThemedText, type ThemedTextProps, type ThemeColor } from "./themed";

export interface SyntaxRun {
  text: string;
  color?: ThemeColor;
}
const scopes: Record<string, ThemeColor> = {
  comment: "subtle",
  quote: "subtle",
  keyword: "plan",
  literal: "warning",
  number: "warning",
  string: "success",
  regexp: "success",
  attr: "accent",
  attribute: "accent",
  title: "accent",
  built_in: "accent",
  type: "remember",
  symbol: "warning",
  bullet: "warning",
  meta: "inactive",
  addition: "success",
  deletion: "error",
};
const extensions: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  h: "c",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  yml: "yaml",
  md: "markdown",
  html: "xml",
  htm: "xml",
  svg: "xml",
  vue: "xml",
};
/** Lex the complete source before selecting rows so multiline grammar state survives folding. */
export function highlightSyntax(
  text: string,
  options: { language?: string; path?: string } = {},
): SyntaxRun[][] {
  const extension = options.path?.split(/[\\/]/).at(-1)?.split(".").at(-1)?.toLowerCase();
  const language =
    options.language ?? (extension ? (extensions[extension] ?? extension) : undefined);
  if (!language || !hljs.getLanguage(language)) return text.split("\n").map((text) => [{ text }]);
  const html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  const lines: SyntaxRun[][] = [[]];
  const stack: (ThemeColor | undefined)[] = [];
  // Only highlight.js's escaped text and generated span markup enter this parser.
  for (const part of html.split(/(<span class="[^"]*">|<\/span>)/)) {
    if (part.startsWith('<span class="')) {
      const classes = part.slice(13, -2).split(" ");
      stack.push(
        classes.map((name) => scopes[name.replace(/^hljs-/, "")]).find(Boolean) ?? stack.at(-1),
      );
    } else if (part === "</span>") stack.pop();
    else {
      const decoded = part.replace(
        /&(amp|lt|gt|quot|#x27);/g,
        (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'" })[entity]!,
      );
      decoded.split("\n").forEach((text, index) => {
        if (index) lines.push([]);
        if (text) lines.at(-1)!.push({ text, color: stack.at(-1) });
      });
    }
  }
  return lines;
}

/** Render prelexed runs for a selected row, or a complete text fragment such as JSON arguments. */
export function SyntaxHighlightedText({
  text = "",
  runs,
  language,
  path,
  ...props
}: Omit<ThemedTextProps, "children"> & {
  text?: string;
  runs?: readonly SyntaxRun[];
  language?: string;
  path?: string;
}) {
  const tokens =
    runs ??
    highlightSyntax(text, { language, path }).flatMap((line, index) =>
      index ? [{ text: "\n" }, ...line] : line,
    );
  return (
    <ThemedText {...props}>
      {tokens.map((run, index) => (
        <ThemedText key={index} color={run.color}>
          {run.text}
        </ThemedText>
      ))}
    </ThemedText>
  );
}
