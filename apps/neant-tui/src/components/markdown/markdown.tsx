import { useMemo, type ReactNode } from "react";
import { fromMarkdown } from "mdast-util-from-markdown";
import { Box, ThemedText } from "@neant/tui";

type Node = ReturnType<typeof fromMarkdown>["children"][number];
type InlineNode = Extract<Node, { type: "paragraph" }>["children"][number];

function inline(nodes: readonly InlineNode[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "strong":
        return (
          <ThemedText key={index} bold>
            {inline(node.children)}
          </ThemedText>
        );
      case "emphasis":
        return (
          <ThemedText key={index} italic>
            {inline(node.children)}
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
            {inline(node.children)}
            {` (${node.url})`}
          </ThemedText>
        );
      case "image":
        return node.alt ?? node.url;
      case "break":
        return "\n";
      case "html":
        return node.value;
      default:
        return "";
    }
  });
}

function blocks(nodes: readonly Node[], onClick?: () => void): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "paragraph":
        return (
          <Box key={index} marginBottom={1}>
            <ThemedText onClick={onClick}>{inline(node.children)}</ThemedText>
          </Box>
        );
      case "heading":
        return (
          <Box key={index} marginBottom={1}>
            <ThemedText onClick={onClick} bold color="accent">
              {inline(node.children)}
            </ThemedText>
          </Box>
        );
      case "code":
        return (
          <Box key={index} marginBottom={1}>
            <ThemedText onClick={onClick} color="subtle" preserveWhitespace>
              {node.value}
            </ThemedText>
          </Box>
        );
      case "list":
        return (
          <Box key={index} flexDirection="column" marginBottom={1}>
            {node.children.map((item, itemIndex) => (
              <Box key={itemIndex}>
                <Box width={4} flexShrink={0}>
                  <ThemedText dimColor>
                    {node.ordered ? `${(node.start ?? 1) + itemIndex}. ` : "• "}
                  </ThemedText>
                </Box>
                <Box flexDirection="column" flexGrow={1}>
                  {blocks(item.children, onClick)}
                </Box>
              </Box>
            ))}
          </Box>
        );
      case "blockquote":
        return (
          <Box key={index}>
            <ThemedText dimColor>│ </ThemedText>
            <Box flexDirection="column" flexGrow={1}>
              {blocks(node.children, onClick)}
            </Box>
          </Box>
        );
      case "thematicBreak":
        return (
          <ThemedText key={index} onClick={onClick} dimColor>
            ────────────────
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

/** CommonMark parsed by micromark, rendered as native terminal text and boxes. */
export function Markdown({ text, onClick }: { text: string; onClick?(): void }) {
  const document = useMemo(() => fromMarkdown(text), [text]);
  return <Box flexDirection="column">{blocks(document.children, onClick)}</Box>;
}

/** Plain text emitted by Markdown, excluding formatting delimiters. */
export function markdownProjection(source: string): { text: string; sourceLines: number[] } {
  type Tree = {
    type: string;
    value?: string;
    url?: string;
    alt?: string | null;
    children?: Tree[];
    position?: { start: { line: number } };
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
    if (node.type === "image") return literal(node.alt ?? node.url ?? "", line);
    if (node.type === "break") return literal("\n", line);
    if (node.value !== undefined) return literal(node.value, line + Number(node.type === "code"));
    const separator = ["root", "list", "listItem", "blockquote"].includes(node.type) ? "\n" : "";
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
    if (node.type === "link") {
      const tail = literal(` (${node.url})`, line);
      output.text += tail.text;
      output.sourceLines.push(...tail.sourceLines);
    }
    return output;
  }
  return visit(fromMarkdown(source));
}
export function markdownText(source: string): string {
  return markdownProjection(source).text;
}
