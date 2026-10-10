import { fromMarkdown } from "mdast-util-from-markdown";
import { createElement, type ReactNode, useMemo } from "react";
import type { RootContent } from "mdast";
import { AgentCode } from "./agents/agent-code";
/** Markdown becomes React nodes. HTML and image/link navigation are inert untrusted content. */
export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const tree = useMemo(() => fromMarkdown(text), [text]);
  const render = (node: RootContent, index: number): ReactNode => {
    if (node.type === "text") return node.value;
    if (node.type === "code") {
      const raw = text.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
      const opening = raw.match(/^(?:`{3,}|~{3,})/)?.[0];
      const closed =
        !opening ||
        new RegExp(`^${opening[0]}{${opening.length},}\\s*$`).test(raw.split("\n").at(-1) ?? "");
      return (
        <div key={index} className="my-3 rounded-xl bg-muted p-3">
          <AgentCode
            code={node.value}
            language={node.lang ?? "text"}
            streaming={streaming && !closed}
          />
        </div>
      );
    }
    if (node.type === "inlineCode")
      return (
        <code key={index} className="rounded bg-muted px-1 font-mono text-ui-sm">
          {node.value}
        </code>
      );
    if (node.type === "html") return <span key={index}>{node.value}</span>;
    if (node.type === "image" || node.type === "imageReference")
      return <span key={index}>{node.alt}</span>;
    if (node.type === "break") return <br key={index} />;
    if (node.type === "thematicBreak") return <hr key={index} className="my-3 border-border" />;
    if (!("children" in node)) return null;
    const children = node.children.map((child, i) => render(child, i));
    if (node.type === "heading")
      return createElement(
        `h${node.depth}`,
        {
          key: index,
          className:
            node.depth === 1
              ? "my-3 text-ui-xl font-semibold"
              : node.depth === 2
                ? "my-3 text-ui-lg font-semibold"
                : `my-2 text-ui-base ${node.depth <= 4 ? "font-semibold" : node.depth === 5 ? "font-medium" : "font-normal"}`,
        },
        children,
      );
    if (node.type === "list")
      return createElement(
        node.ordered ? "ol" : "ul",
        {
          key: index,
          start: node.ordered ? (node.start ?? undefined) : undefined,
          className: node.ordered ? "my-2 list-decimal pl-5" : "my-2 list-disc pl-5",
        },
        children,
      );
    const tags: Record<string, string> = {
      paragraph: "p",
      strong: "strong",
      emphasis: "em",
      listItem: "li",
      blockquote: "blockquote",
      link: "span",
      linkReference: "span",
    };
    return createElement(
      tags[node.type] ?? "span",
      {
        key: index,
        className:
          node.type === "paragraph"
            ? "my-2 whitespace-pre-wrap break-words"
            : node.type === "blockquote"
              ? "border-l-2 border-border pl-3 text-muted-foreground"
              : undefined,
      },
      children,
    );
  };
  return <div className="min-w-0 text-ui-base leading-6">{tree.children.map(render)}</div>;
}
