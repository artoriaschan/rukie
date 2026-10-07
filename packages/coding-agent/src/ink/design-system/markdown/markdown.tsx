import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from "react";
import { fromMarkdown } from "mdast-util-from-markdown";
import { Box } from "../../primitives";
import { ThemedBox, ThemedText as StyledText } from "../themed";
import {
  SyntaxHighlightedText as HighlightedText,
  highlightSyntax,
} from "../syntax-highlighted-text";
import { useTerminalSize } from "../../hooks";
import { textLines } from "../../text";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import { render as renderMermaid } from "lovely-mermaid";
import { renderLatex } from "./latex";

const DimContext = createContext(false);
function ThemedText(props: ComponentProps<typeof StyledText>) {
  const dimColor = useContext(DimContext);
  return <StyledText {...props} dimColor={props.dimColor ?? dimColor} />;
}
function SyntaxHighlightedText(props: ComponentProps<typeof HighlightedText>) {
  const dimColor = useContext(DimContext);
  return <HighlightedText {...props} dimColor={props.dimColor ?? dimColor} />;
}

function parse(text: string) {
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
function raw(
  node: { position?: { start: { offset?: number }; end: { offset?: number } } },
  source: string,
) {
  return source.slice(node.position?.start.offset, node.position?.end.offset);
}
function formula(value: string, display: boolean): string | undefined {
  if (value.length > 4096) return undefined;
  try {
    return renderLatex(value, { display });
  } catch {
    return undefined;
  }
}

type Node = ReturnType<typeof fromMarkdown>["children"][number];
type InlineNode = Extract<Node, { type: "paragraph" }>["children"][number];

function inline(nodes: readonly InlineNode[], source = ""): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "inlineMath":
        return <InlineFormula key={index} node={node} source={source} />;
      case "delete":
        return (
          <ThemedText key={index} strikethrough>
            {inline(node.children, source)}
          </ThemedText>
        );
      case "text":
        return node.value;
      case "strong":
        return (
          <ThemedText key={index} bold>
            {inline(node.children, source)}
          </ThemedText>
        );
      case "emphasis":
        return (
          <ThemedText key={index} italic>
            {inline(node.children, source)}
          </ThemedText>
        );
      case "inlineCode":
        return (
          <ThemedText key={index} color="accent">
            {node.value}
          </ThemedText>
        );
      case "link":
        return (
          <ThemedText key={index} color="accent">
            {inline(node.children, source)}
          </ThemedText>
        );
      case "image":
        return node.alt ? `[img] ${node.alt}` : node.url;
      case "break":
        return "\n";
      case "html":
        return node.value;
      default:
        return "";
    }
  });
}

function blocks(
  nodes: readonly Node[],
  onClick?: () => void,
  tight = false,
  source = "",
): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "math":
        return <MathBlock key={index} node={node} source={source} onClick={onClick} />;
      case "table":
        return <TableBlock key={index} node={node} source={source} onClick={onClick} />;
      case "paragraph": {
        const literal = raw(node, source);
        if (
          /^\\begin\{(?:align\*?|aligned|equation\*?|gather\*?|matrix|pmatrix|bmatrix|cases)\}/.test(
            literal,
          )
        )
          return <EnvironmentBlock key={index} text={literal} onClick={onClick} />;
        return (
          <Box key={index} marginBottom={tight || index === nodes.length - 1 ? 0 : 1}>
            <ThemedText onClick={onClick}>{inline(node.children, source)}</ThemedText>
          </Box>
        );
      }
      case "heading":
        return (
          <Box key={index} marginBottom={tight || index === nodes.length - 1 ? 0 : 1}>
            <ThemedText
              onClick={onClick}
              bold={node.depth <= 4}
              underline={node.depth === 1}
              italic={node.depth === 4 || node.depth === 5}
              color={
                node.depth === 1
                  ? "accent"
                  : node.depth === 2
                    ? "permission"
                    : node.depth >= 5
                      ? "subtle"
                      : "text"
              }
            >
              {inline(node.children, source)}
            </ThemedText>
          </Box>
        );
      case "code":
        return <CodeBlock key={index} node={node} onClick={onClick} />;
      case "list":
        return (
          <Box
            key={index}
            flexDirection="column"
            marginBottom={tight || index === nodes.length - 1 ? 0 : 1}
          >
            {node.children.map((item, itemIndex) => (
              <Box key={itemIndex}>
                <Box
                  width={node.ordered ? String((node.start ?? 1) + itemIndex).length + 2 : 2}
                  flexShrink={0}
                >
                  <ThemedText color="permission">
                    {node.ordered ? `${(node.start ?? 1) + itemIndex}. ` : "- "}
                  </ThemedText>
                </Box>
                <Box flexDirection="column" flexGrow={1}>
                  {item.checked == null ? (
                    blocks(item.children, onClick, !node.spread, source)
                  ) : (
                    <Box>
                      <Box width={4} flexShrink={0}>
                        <ThemedText>{item.checked ? "[x]" : "[ ]"}</ThemedText>
                      </Box>
                      <Box flexDirection="column" flexGrow={1}>
                        {blocks(item.children, onClick, !node.spread, source)}
                      </Box>
                    </Box>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        );
      case "blockquote":
        return (
          <Box key={index}>
            <Box width={2} flexShrink={0}>
              <ThemedText color="subtle" selectable={false}>
                ▎
              </ThemedText>
            </Box>
            <Box flexDirection="column" flexGrow={1}>
              {blocks(node.children, onClick, false, source)}
            </Box>
          </Box>
        );
      case "thematicBreak":
        return (
          <ThemedText key={index} onClick={onClick} dimColor>
            ───
          </ThemedText>
        );
      case "html":
        return (
          <ThemedText key={index} onClick={onClick}>
            {node.value}
          </ThemedText>
        );
      default:
        return null;
    }
  });
}

function mathText(
  node: {
    type: string;
    value?: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
  },
  source: string,
  columns: number,
): string {
  const literal = raw(node, source);
  const inline = node.type === "inlineMath";
  const closed = inline || /\n[ \t]*(?:\$\$+|\\\])[ \t]*$/.test(literal);
  const price = inline && /^\$\d/.test(literal);
  const rendered = closed && !price ? formula(node.value ?? "", !inline) : undefined;
  return rendered &&
    (!inline || !rendered.includes("\n")) &&
    rendered.split("\n").every((row) => Bun.stringWidth(row) <= columns - 4)
    ? rendered
    : literal;
}
function InlineFormula({
  node,
  source,
}: {
  node: Extract<InlineNode, { type: "inlineMath" }>;
  source: string;
}) {
  const { columns } = useTerminalSize();
  return mathText(node, source, columns);
}
function EnvironmentBlock({ text, onClick }: { text: string; onClick?: () => void }) {
  const { columns } = useTerminalSize();
  const name = /^\\begin\{([^}]+)\}/.exec(text)?.[1];
  const rendered = name && text.endsWith(`\\end{${name}}`) ? formula(text, true) : undefined;
  const fits = rendered && rendered.split("\n").every((row) => Bun.stringWidth(row) <= columns - 4);
  return (
    <ThemedText onClick={onClick} preserveWhitespace>
      {fits ? rendered : text}
    </ThemedText>
  );
}
function MathBlock({
  node,
  source,
  onClick,
}: {
  node: Extract<Node, { type: "math" }>;
  source: string;
  onClick?: () => void;
}) {
  const { columns } = useTerminalSize();
  return (
    <ThemedText onClick={onClick} preserveWhitespace>
      {mathText(node, source, columns)}
    </ThemedText>
  );
}
function CodeBlock({
  node,
  onClick,
}: {
  node: Extract<Node, { type: "code" }>;
  onClick?: () => void;
}) {
  const { columns } = useTerminalSize();
  const art = useMemo(() => {
    if (node.lang?.toLowerCase() !== "mermaid" || node.value.length > 20000) return null;
    try {
      return renderMermaid(node.value);
    } catch {
      return null;
    }
  }, [node.lang, node.value]);
  const label = node.lang ?? "code";
  const highlighted = useMemo(
    () =>
      highlightSyntax(node.value, { language: node.lang ?? undefined }).flatMap((row, i) =>
        i ? [{ text: "\n" }, ...row] : row,
      ),
    [node.value, node.lang],
  );
  const diagram = art && art.width <= columns - 4;
  if (diagram)
    return (
      <Box flexDirection="column">
        {art.styled.map((row, index) => (
          <ThemedText key={index} onClick={onClick} preserveWhitespace>
            {row.map((run, at) => (
              <ThemedText
                key={at}
                color={run.role === "border" ? "subtle" : run.role === "edge" ? "accent" : "text"}
              >
                {run.text}
              </ThemedText>
            ))}
          </ThemedText>
        ))}
      </Box>
    );
  if (columns - 6 < 8)
    return (
      <Box flexDirection="column">
        <ThemedText color="subtle" selectable={false}>{`\`\`\`${label}`}</ThemedText>
        <Box paddingLeft={2}>
          <SyntaxHighlightedText
            text={node.value}
            language={node.lang ?? undefined}
            onClick={onClick}
            preserveWhitespace
          />
        </Box>
      </Box>
    );
  return (
    <ThemedBox borderStyle="single" borderColor="subtle" flexDirection="column" paddingX={1}>
      <Box position="absolute" left={1} right={1} top={-1} height={1} selectable={false}>
        <ThemedText color="subtle" wrap="truncate">{` ${label} `}</ThemedText>
      </Box>
      <SyntaxHighlightedText runs={highlighted} onClick={onClick} preserveWhitespace />
    </ThemedBox>
  );
}
function TableBlock({
  node,
  source,
  onClick,
}: {
  node: Extract<Node, { type: "table" }>;
  source: string;
  onClick?: () => void;
}) {
  const { columns } = useTerminalSize();
  const values = node.children.map((row) =>
    row.children.map((cell) => markdownText(raw(cell, source))),
  );
  const count = node.children[0]?.children.length ?? 0;
  const budget = Math.max(0, columns - 5 - count * 3);
  const minimum = Array.from({ length: count }, (_, i) =>
    Math.max(
      3,
      ...values.flatMap((row) => (row[i] ?? "").split(/\s+/).map((word) => Bun.stringWidth(word))),
    ),
  );
  const ideal = Array.from({ length: count }, (_, i) =>
    Math.max(3, ...values.map((row) => Bun.stringWidth(row[i] ?? ""))),
  );
  const widths = [...minimum];
  let remaining = budget - widths.reduce((sum, width) => sum + width, 0);
  while (remaining > 0) {
    const room = ideal.map((width, i) => width - widths[i]!);
    const at = room.indexOf(Math.max(...room));
    if (room[at]! <= 0) break;
    widths[at]!++;
    remaining--;
  }
  const wrapped = values.map((row) =>
    row.map((value, i) =>
      textLines([{ text: value, style: {} }], widths[i]).map((line) =>
        line.map((glyph) => glyph.text).join(""),
      ),
    ),
  );
  const vertical =
    widths.reduce((sum, width) => sum + width, 0) > budget ||
    wrapped.some((row) => row.some((cell) => cell.length > 4));
  if (vertical)
    return (
      <Box flexDirection="column">
        {node.children.slice(1).map((row, index) => (
          <Box key={index} flexDirection="column" marginTop={index ? 1 : 0}>
            {row.children.map((cell, i) => (
              <ThemedText key={i} onClick={onClick}>
                <ThemedText bold>{values[0]?.[i] ?? `Column ${i + 1}`}: </ThemedText>
                {inline(cell.children, source)}
              </ThemedText>
            ))}
          </Box>
        ))}
      </Box>
    );
  const border = (left: string, join: string, right: string) =>
    left + widths.map((width) => "─".repeat(width + 2)).join(join) + right;
  return (
    <Box flexDirection="column">
      <ThemedText color="subtle" selectable={false}>
        {border("┌", "┬", "┐")}
      </ThemedText>
      {wrapped.map((row, index) => {
        const height = Math.max(1, ...row.map((cell) => cell.length));
        return (
          <Box key={index} flexDirection="column">
            {Array.from({ length: height }, (_, line) => (
              <Box key={line}>
                <ThemedText color="subtle" selectable={false}>
                  │
                </ThemedText>
                {row.map((cell, i) => {
                  const offset = Math.floor((height - cell.length) / 2);
                  const value = cell[line - offset] ?? "";
                  const gap = Math.max(0, widths[i]! - Bun.stringWidth(value));
                  const alignment = index === 0 ? "center" : node.align?.[i];
                  const before =
                    alignment === "right" ? gap : alignment === "center" ? Math.floor(gap / 2) : 0;
                  return (
                    <Box key={i}>
                      <ThemedText onClick={onClick} bold={index === 0} preserveWhitespace>
                        {" ".repeat(before + 1)}
                        {cell.length === 1 && line === offset
                          ? inline(node.children[index]!.children[i]!.children, source)
                          : value}
                        {" ".repeat(gap - before + 1)}
                      </ThemedText>
                      <ThemedText color="subtle" selectable={false}>
                        │
                      </ThemedText>
                    </Box>
                  );
                })}
              </Box>
            ))}
            {index < wrapped.length - 1 && (
              <ThemedText color="subtle" selectable={false}>
                {border("├", "┼", "┤")}
              </ThemedText>
            )}
          </Box>
        );
      })}
      <ThemedText color="subtle" selectable={false}>
        {border("└", "┴", "┘")}
      </ThemedText>
    </Box>
  );
}

/** CommonMark parsed by micromark, rendered as native terminal text and boxes. */
export function Markdown({
  text,
  onClick,
  dimColor = false,
}: {
  text: string;
  onClick?(): void;
  dimColor?: boolean;
}) {
  const document = useMemo(() => parse(text), [text]);
  return (
    <DimContext.Provider value={dimColor}>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {blocks(document.children, onClick, false, text)}
      </Box>
    </DimContext.Provider>
  );
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
    if (
      node.type === "code" &&
      node.lang?.toLowerCase() === "mermaid" &&
      (node.value?.length ?? 0) <= 20000
    ) {
      try {
        const art = renderMermaid(node.value ?? "");
        if (art && art.width <= columns - 4) return literal(art.plain.join("\n"), line + 1);
      } catch {
        /* Unsupported source retains its code text. */
      }
    }
    if (node.type === "paragraph") {
      const original = raw(node, source);
      const name = /^\\begin\{([^}]+)\}/.exec(original)?.[1];
      if (name) {
        const rendered = original.endsWith(`\\end{${name}}`) ? formula(original, true) : undefined;
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
  return visit(parse(source));
}
export function markdownText(source: string, columns = Infinity): string {
  return markdownProjection(source, columns).text;
}
