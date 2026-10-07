import { InteractiveText } from "../interactive-text";
import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from "react";
import {
  Box,
  ThemedBox,
  ThemedText as StyledText,
  SyntaxHighlightedText as HighlightedText,
  highlightSyntax,
  useTerminalSize,
  textLines,
} from "../../../ink/index.ts";
import {
  parseMarkdown,
  rawMarkdown,
  renderFormula,
  mathText,
  mermaidDiagram,
  markdownText,
} from "../../../view/transcript/markdown";

const DimContext = createContext(false);
function ThemedText(props: ComponentProps<typeof StyledText>) {
  const dim = useContext(DimContext);
  return <StyledText {...props} dim={props.dim ?? dim} />;
}
function SyntaxHighlightedText(props: ComponentProps<typeof HighlightedText>) {
  const dim = useContext(DimContext);
  return <HighlightedText {...props} dim={props.dim ?? dim} />;
}

type Node = ReturnType<typeof parseMarkdown>["children"][number];
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
        const literal = rawMarkdown(node, source);
        if (
          /^\\begin\{(?:align\*?|aligned|equation\*?|gather\*?|matrix|pmatrix|bmatrix|cases)\}/.test(
            literal,
          )
        )
          return <EnvironmentBlock key={index} text={literal} onClick={onClick} />;
        return (
          <Box
            flexShrink={0}
            key={index}
            marginBottom={tight || index === nodes.length - 1 ? 0 : 1}
          >
            <InteractiveText onClick={onClick}>{inline(node.children, source)}</InteractiveText>
          </Box>
        );
      }
      case "heading":
        return (
          <Box
            flexShrink={0}
            key={index}
            marginBottom={tight || index === nodes.length - 1 ? 0 : 1}
          >
            <InteractiveText
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
            </InteractiveText>
          </Box>
        );
      case "code":
        return <CodeBlock key={index} node={node} onClick={onClick} />;
      case "list":
        return (
          <Box
            flexShrink={0}
            key={index}
            flexDirection="column"
            marginBottom={tight || index === nodes.length - 1 ? 0 : 1}
          >
            {node.children.map((item, itemIndex) => (
              <Box flexShrink={0} key={itemIndex}>
                <Box
                  width={node.ordered ? String((node.start ?? 1) + itemIndex).length + 2 : 2}
                  flexShrink={0}
                >
                  <ThemedText color="permission">
                    {node.ordered ? `${(node.start ?? 1) + itemIndex}. ` : "- "}
                  </ThemedText>
                </Box>
                <Box flexShrink={0} flexDirection="column" flexGrow={1}>
                  {item.checked == null ? (
                    blocks(item.children, onClick, !node.spread, source)
                  ) : (
                    <Box flexShrink={0}>
                      <Box width={4} flexShrink={0}>
                        <ThemedText>{item.checked ? "[x]" : "[ ]"}</ThemedText>
                      </Box>
                      <Box flexShrink={0} flexDirection="column" flexGrow={1}>
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
          <Box flexShrink={0} key={index}>
            <Box width={2} flexShrink={0}>
              <InteractiveText color="subtle" noSelect>
                ▎
              </InteractiveText>
            </Box>
            <Box flexShrink={0} flexDirection="column" flexGrow={1}>
              {blocks(node.children, onClick, false, source)}
            </Box>
          </Box>
        );
      case "thematicBreak":
        return (
          <InteractiveText key={index} onClick={onClick} dim>
            ───
          </InteractiveText>
        );
      case "html":
        return (
          <InteractiveText key={index} onClick={onClick}>
            {node.value}
          </InteractiveText>
        );
      default:
        return null;
    }
  });
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
  const rendered = name && text.endsWith(`\\end{${name}}`) ? renderFormula(text, true) : undefined;
  const fits = rendered && rendered.split("\n").every((row) => Bun.stringWidth(row) <= columns - 4);
  return <InteractiveText onClick={onClick}>{fits ? rendered : text}</InteractiveText>;
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
  return <InteractiveText onClick={onClick}>{mathText(node, source, columns)}</InteractiveText>;
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
    return node.lang?.toLowerCase() === "mermaid" ? mermaidDiagram(node.value) : null;
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
      <Box flexShrink={0} flexDirection="column">
        {art.styled.map((row, index) => (
          <InteractiveText key={index} onClick={onClick}>
            {row.map((run, at) => (
              <ThemedText
                key={at}
                color={run.role === "border" ? "subtle" : run.role === "edge" ? "accent" : "text"}
              >
                {run.text}
              </ThemedText>
            ))}
          </InteractiveText>
        ))}
      </Box>
    );
  if (columns - 6 < 8)
    return (
      <Box flexShrink={0} flexDirection="column">
        <InteractiveText color="subtle" noSelect>{`\`\`\`${label}`}</InteractiveText>
        <Box flexShrink={0} paddingLeft={2} onClick={onClick}>
          <SyntaxHighlightedText text={node.value} language={node.lang ?? undefined} />
        </Box>
      </Box>
    );
  return (
    <Box flexShrink={0} width="100%" flexDirection="column">
      <ThemedBox
        flexShrink={0}
        width="100%"
        borderStyle="single"
        borderColor="subtle"
        flexDirection="column"
        paddingX={1}
      >
        <Box flexShrink={0} onClick={onClick}>
          <SyntaxHighlightedText runs={highlighted} />
        </Box>
      </ThemedBox>
      <Box position="absolute" left={2} right={1} top={0} height={1} noSelect>
        <ThemedText color="subtle" wrap="truncate">{` ${label} `}</ThemedText>
      </Box>
      <Box position="absolute" left={0} right={0} top={0} height={1} noSelect />
      <Box position="absolute" left={0} right={0} bottom={0} height={1} noSelect />
      <Box position="absolute" left={0} top={1} bottom={1} width={2} noSelect />
      <Box position="absolute" right={0} top={1} bottom={1} width={2} noSelect />
    </Box>
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
    row.children.map((cell) => markdownText(rawMarkdown(cell, source))),
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
      <Box flexShrink={0} flexDirection="column">
        {node.children.slice(1).map((row, index) => (
          <Box flexShrink={0} key={index} flexDirection="column" marginTop={index ? 1 : 0}>
            {row.children.map((cell, i) => (
              <InteractiveText key={i} onClick={onClick}>
                <ThemedText bold>{values[0]?.[i] ?? `Column ${i + 1}`}: </ThemedText>
                {inline(cell.children, source)}
              </InteractiveText>
            ))}
          </Box>
        ))}
      </Box>
    );
  const border = (left: string, join: string, right: string) =>
    left + widths.map((width) => "─".repeat(width + 2)).join(join) + right;
  return (
    <Box flexShrink={0} flexDirection="column">
      <InteractiveText color="subtle" noSelect>
        {border("┌", "┬", "┐")}
      </InteractiveText>
      {wrapped.map((row, index) => {
        const height = Math.max(1, ...row.map((cell) => cell.length));
        return (
          <Box flexShrink={0} key={index} flexDirection="column">
            {Array.from({ length: height }, (_, line) => (
              <Box flexShrink={0} key={line}>
                <InteractiveText color="subtle" noSelect>
                  │
                </InteractiveText>
                {row.map((cell, i) => {
                  const offset = Math.floor((height - cell.length) / 2);
                  const value = cell[line - offset] ?? "";
                  const gap = Math.max(0, widths[i]! - Bun.stringWidth(value));
                  const alignment = index === 0 ? "center" : node.align?.[i];
                  const before =
                    alignment === "right" ? gap : alignment === "center" ? Math.floor(gap / 2) : 0;
                  return (
                    <Box flexShrink={0} key={i}>
                      <InteractiveText onClick={onClick} bold={index === 0}>
                        {" ".repeat(before + 1)}
                        {cell.length === 1 && line === offset
                          ? inline(node.children[index]!.children[i]!.children, source)
                          : value}
                        {" ".repeat(gap - before + 1)}
                      </InteractiveText>
                      <InteractiveText color="subtle" noSelect>
                        │
                      </InteractiveText>
                    </Box>
                  );
                })}
              </Box>
            ))}
            {index < wrapped.length - 1 && (
              <InteractiveText color="subtle" noSelect>
                {border("├", "┼", "┤")}
              </InteractiveText>
            )}
          </Box>
        );
      })}
      <InteractiveText color="subtle" noSelect>
        {border("└", "┴", "┘")}
      </InteractiveText>
    </Box>
  );
}

/** CommonMark parsed by micromark, rendered as native terminal text and boxes. */
export function Markdown({
  text,
  onClick,
  dim = false,
}: {
  text: string;
  onClick?(): void;
  dim?: boolean;
}) {
  const document = useMemo(() => parseMarkdown(text), [text]);
  return (
    <DimContext.Provider value={dim}>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {blocks(document.children, onClick, false, text)}
      </Box>
    </DimContext.Provider>
  );
}
