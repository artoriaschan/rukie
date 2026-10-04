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

function blocks(nodes: readonly Node[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "paragraph":
        return (
          <Box key={index} marginBottom={1}>
            <ThemedText>{inline(node.children)}</ThemedText>
          </Box>
        );
      case "heading":
        return (
          <Box key={index} marginBottom={1}>
            <ThemedText bold color="accent">
              {inline(node.children)}
            </ThemedText>
          </Box>
        );
      case "code":
        return (
          <Box key={index} marginBottom={1}>
            <ThemedText color="subtle" preserveWhitespace>
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
                  {blocks(item.children)}
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
              {blocks(node.children)}
            </Box>
          </Box>
        );
      case "thematicBreak":
        return (
          <ThemedText key={index} dimColor>
            ────────────────
          </ThemedText>
        );
      case "html":
        return <ThemedText key={index}>{node.value}</ThemedText>;
      default:
        return null;
    }
  });
}

/** CommonMark parsed by micromark, rendered as native terminal text and boxes. */
export function Markdown({ text }: { text: string }) {
  const document = useMemo(() => fromMarkdown(text), [text]);
  return <Box flexDirection="column">{blocks(document.children)}</Box>;
}
