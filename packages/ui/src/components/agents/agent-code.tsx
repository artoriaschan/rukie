import { type CSSProperties, Fragment, useEffect, useRef, useState } from "react";
import type { ThemedToken } from "shiki/core";
// The Node builtin restriction matches the scoped basename; this package uses browser APIs only.
// eslint-disable-next-line no-restricted-imports
import { ShikiStreamTokenizer } from "@shikijs/stream";
import {
  canHighlight,
  codeLanguage,
  getHighlighter,
  highlight,
  highlightThemes,
} from "@/lib/highlight";
import { cn } from "@/lib/utils";
export type AgentCodeLanguage = string;
export type AgentCodeToken = ThemedToken;
export interface AgentCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
  streaming?: boolean;
}
export interface AgentCodeLineProps {
  code: string;
  tokens?: AgentCodeToken[];
  className?: string;
}
export function useAgentCodeTokens(code: string, language: string, streaming = false) {
  const [result, setResult] = useState<{ code: string; lines: ThemedToken[][] } | null>(null);
  const stream = useRef<{ language: string; code: string; tokenizer: ShikiStreamTokenizer } | null>(
    null,
  );
  const serial = useRef(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    serial.current = serial.current
      .then(async () => {
        if (cancelled) return;
        if (!canHighlight(code)) {
          stream.current = null;
          setResult(null);
          return;
        }
        if (!streaming) {
          const lines = await highlight(code, language);
          if (!cancelled) setResult(lines ? { code, lines } : null);
          return;
        }
        const highlighter = await getHighlighter();
        if (cancelled) return;
        let current = stream.current;
        if (!current || current.language !== language || !code.startsWith(current.code))
          current = {
            language,
            code: "",
            tokenizer: new ShikiStreamTokenizer({
              highlighter,
              lang: codeLanguage(language),
              themes: highlightThemes,
              defaultColor: false,
            }),
          };
        await current.tokenizer.enqueue(code.slice(current.code.length));
        current.code = code;
        stream.current = current;
        const lines: ThemedToken[][] = [[]];
        for (const token of [
          ...current.tokenizer.tokensStable,
          ...current.tokenizer.tokensUnstable,
        ]) {
          if (token.content === "\n") lines.push([]);
          else lines.at(-1)!.push(token);
        }
        if (!cancelled) setResult({ code, lines });
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language, streaming]);
  return result?.code === code ? result.lines : null;
}
export function AgentCodeLine({ code, tokens, className }: AgentCodeLineProps) {
  return (
    <span className={className}>
      {tokens
        ? tokens.map((token, index) => (
            <span key={index} style={token.htmlStyle as CSSProperties} className="shiki-token">
              {token.content}
            </span>
          ))
        : code}
    </span>
  );
}
export function AgentCode({
  code,
  language = "text",
  className,
  streaming = false,
}: AgentCodeProps) {
  const tokens = useAgentCodeTokens(code, language, streaming);
  return (
    <pre
      data-highlight={canHighlight(code) ? "eligible" : "skipped"}
      className={cn(
        "m-0 overflow-x-auto whitespace-pre font-mono text-ui-sm leading-5 text-foreground/85",
        className,
      )}
    >
      <code>
        {code.split("\n").map((line, index) => (
          <Fragment key={index}>
            <AgentCodeLine code={line} tokens={tokens?.[index]} />
            {index < code.split("\n").length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
