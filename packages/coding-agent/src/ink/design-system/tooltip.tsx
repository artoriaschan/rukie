import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useInput, useTerminalFocus, useTerminalSize } from "../hooks";
import { textLines, lineWidth } from "../text";
import { ThemedBox, ThemedText, type ThemedBoxProps } from "./themed";

interface Request {
  owner: symbol;
  text(): string;
  x: number;
  y: number;
}
const TooltipContext = createContext<
  | {
      show(request: Request): void;
      hide(owner?: symbol): void;
    }
  | undefined
>(undefined);

/** Own one delayed overlay per terminal tree; render it outside scroll-clipped content. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  const { columns, rows } = useTerminalSize();
  const focused = useTerminalFocus();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<Request | undefined>(undefined);
  const [visible, setVisible] = useState<(Request & { content: string }) | undefined>(undefined);
  const hide = useCallback((owner?: symbol) => {
    if (owner && request.current?.owner !== owner) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    request.current = undefined;
    setVisible(undefined);
  }, []);
  const show = useCallback(
    (next: Request) => {
      hide();
      request.current = next;
      timer.current = setTimeout(() => {
        timer.current = undefined;
        if (request.current === next) setVisible({ ...next, content: next.text() });
      }, 600);
    },
    [hide],
  );
  useEffect(() => {
    hide();
    return hide;
  }, [columns, rows, focused, hide]);
  useInput((event) => {
    if (event.type !== "move") hide();
  });
  const innerWidth = Math.max(1, Math.min(76, columns - 2));
  const wrapped = visible
    ? textLines([{ text: visible.content, style: {} }], innerWidth, true, true)
    : [];
  const below = visible ? rows - visible.y - 1 : 0;
  const above = visible?.y ?? 0;
  const bottomSide = below >= wrapped.length + 2 || below >= above;
  const space = bottomSide ? below : above;
  const lines = wrapped.slice(0, Math.max(0, space - 2));
  const width = Math.min(columns, Math.max(3, ...lines.map((line) => lineWidth(line) + 2)));
  const height = lines.length + 2;
  const left = Math.max(0, Math.min(visible?.x ?? 0, columns - width));
  const top = Math.max(
    0,
    Math.min(rows - height, bottomSide ? (visible?.y ?? 0) + 1 : (visible?.y ?? 0) - height),
  );
  return (
    <TooltipContext.Provider value={{ show, hide }}>
      <ThemedBox width={columns} height={rows} flexDirection="column">
        {children}
        {visible && focused && columns >= 3 && rows >= 3 && lines.length > 0 && (
          <ThemedBox
            position="absolute"
            top={top}
            left={left}
            width={width}
            height={height}
            borderStyle="round"
            backgroundColor="toolCardBackground"
            flexDirection="column"
          >
            {lines.map((line, index) => (
              <ThemedText key={index} wrap="truncate">
                {line.map((glyph) => glyph.text).join("")}
              </ThemedText>
            ))}
          </ThemedBox>
        )}
      </ThemedBox>
    </TooltipContext.Provider>
  );
}

/** Cancel an overlay when a frontend replaces its page or opens an interaction. */
export function useDismissTooltip() {
  return useContext(TooltipContext)?.hide;
}

/** Only wrap titles that hide content. The text getter is evaluated when the delay ends. */
export function Tooltip({
  content,
  disabled = false,
  children,
  ...props
}: Omit<ThemedBoxProps, "onMouseEnter" | "onMouseLeave"> & {
  content?: string;
  disabled?: boolean;
}) {
  const context = useContext(TooltipContext);
  const owner = useRef(Symbol("tooltip"));
  const latest = useRef(content);
  latest.current = content;
  const hide = context?.hide;
  useEffect(() => {
    if (disabled || !content) hide?.(owner.current);
  }, [disabled, content, hide]);
  useEffect(() => () => hide?.(owner.current), [hide]);
  return (
    <ThemedBox
      {...props}
      onMouseEnter={(position) => {
        if (!disabled && latest.current)
          context?.show({ owner: owner.current, text: () => latest.current ?? "", ...position });
      }}
      onMouseLeave={() => hide?.(owner.current)}
    >
      {children}
    </ThemedBox>
  );
}
