import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import { render as renderMermaid } from "lovely-mermaid";
import { renderLatex } from "./latex";

export function parseMarkdown(text: string) {
  // Keep offsets identical when recognizing TeX delimiters. Code and HTML are
  // protected from normalization; fallback always slices the original source.
  if (!/\\[()[\]]/.test(text))
    return fromMarkdown(text, {
      extensions: [gfm(), math()],
      mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
    });
  const base = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const protectedRanges: [number, number][] = [];
  function protect(node: {
    type: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
    children?: readonly { type: string; children?: readonly { type: string }[] }[];
  }) {
    if (["code", "inlineCode", "html"].includes(node.type))
      protectedRanges.push([node.position?.start.offset ?? 0, node.position?.end.offset ?? 0]);
    if (node.children) for (const child of node.children) protect(child);
  }
  protect(base);
  const normalized = text.replace(/\\([()[\]])/g, (literal, delimiter: string, offset: number) => {
    if (protectedRanges.some(([start, end]) => offset >= start && offset < end)) return literal;
    return delimiter === "(" ? "$ " : delimiter === ")" ? " $" : "$$";
  });
  return fromMarkdown(normalized, {
    extensions: [gfm(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  });
}
export function rawMarkdown(
  node: { position?: { start: { offset?: number }; end: { offset?: number } } },
  source: string,
) {
  return source.slice(node.position?.start.offset, node.position?.end.offset);
}
export function renderFormula(value: string, display: boolean): string | undefined {
  if (value.length > 4096) return undefined;
  try {
    return renderLatex(value, { display });
  } catch {
    return undefined;
  }
}

export function mathText(
  node: {
    type: string;
    value?: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
  },
  source: string,
  columns: number,
): string {
  const literal = rawMarkdown(node, source);
  const inline = node.type === "inlineMath";
  const closed = inline || /\n[ \t]*(?:\$\$+|\\\])[ \t]*$/.test(literal);
  const price = inline && /^\$\d/.test(literal);
  const rendered = closed && !price ? renderFormula(node.value ?? "", !inline) : undefined;
  return rendered &&
    (!inline || !rendered.includes("\n")) &&
    rendered.split("\n").every((row) => Bun.stringWidth(row) <= columns - 4)
    ? rendered
    : literal;
}
export function mermaidDiagram(value: string) {
  if (value.length > 20000) return null;
  try {
    return renderMermaid(value);
  } catch {
    return null;
  }
}

/** Plain text emitted by Markdown, excluding formatting delimiters. */
export function markdownProjection(
  source: string,
  columns = Infinity,
): { text: string; sourceLines: number[] } {
  type Tree = {
    type: string;
    value?: string;
    url?: string;
    alt?: string | null;
    children?: Tree[];
    lang?: string | null;
    position?: { start: { line: number; offset?: number }; end: { offset?: number } };
  };
  function literal(text: string, line: number) {
    const sourceLines: number[] = [];
    for (let at = 0; at < text.length; at++) {
      sourceLines.push(line);
      if (text[at] === "\n") line++;
    }
    return { text, sourceLines };
  }
  function visit(node: Tree): { text: string; sourceLines: number[] } {
    const line = (node.position?.start.line ?? 1) - 1;
    if (node.type === "image")
      return literal(node.alt ? `[img] ${node.alt}` : (node.url ?? ""), line);
    if (node.type === "break") return literal("\n", line);
    if (node.type === "inlineMath" || node.type === "math")
      return literal(mathText(node, source, columns), line);
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") {
      const art = mermaidDiagram(node.value ?? "");
      if (art && art.width <= columns - 4) return literal(art.plain.join("\n"), line + 1);
    }
    if (node.type === "paragraph") {
      const original = rawMarkdown(node, source);
      const name = /^\\begin\{([^}]+)\}/.exec(original)?.[1];
      if (name) {
        const rendered = original.endsWith(`\\end{${name}}`)
          ? renderFormula(original, true)
          : undefined;
        return literal(
          rendered && rendered.split("\n").every((row) => Bun.stringWidth(row) <= columns - 4)
            ? rendered
            : original,
          line,
        );
      }
    }
    if (node.value !== undefined) return literal(node.value, line + Number(node.type === "code"));
    const separator = ["root", "list", "listItem", "blockquote", "table", "tableRow"].includes(
      node.type,
    )
      ? "\n"
      : "";
    const output = { text: "", sourceLines: [] as number[] };
    for (const child of node.children ?? []) {
      const part = visit(child);
      if (output.text && separator) {
        output.text += separator;
        output.sourceLines.push(part.sourceLines[0] ?? line);
      }
      output.text += part.text;
      output.sourceLines.push(...part.sourceLines);
    }
    return output;
  }
  return visit(parseMarkdown(source));
}
export function markdownText(source: string, columns = Infinity): string {
  return markdownProjection(source, columns).text;
}
