import { useRef } from "react";
import {
  Box,
  ThemedText,
  type ThemedTextProps,
  type DOMElement,
  type ClickEvent,
  textLines,
} from "../../ink/index.ts";

function paintedText(node: DOMElement): string {
  return node.childNodes
    .map((child) => (child.nodeName === "#text" ? child.nodeValue : paintedText(child)))
    .join("");
}
/** Product text hit target: both press and release must land on admitted painted glyphs. */
export function InteractiveText({
  onClick,
  noSelect,
  ...props
}: ThemedTextProps & { onClick?(event: ClickEvent): void; noSelect?: boolean }) {
  const text = useRef<DOMElement>(null);
  const hit = (col: number, row: number) => {
    const element = text.current;
    if (!element) return false;
    const width = element.yogaNode?.getComputedWidth() ?? 0;
    const lines = textLines([{ text: paintedText(element), style: {} }], Math.max(1, width));
    let column = 0;
    const glyph = lines[row]?.find((glyph) => {
      const at = column;
      column += glyph.width;
      return col >= at && col < column;
    });
    return !!glyph?.text.trim();
  };
  return (
    <Box
      flexShrink={0}
      noSelect={noSelect}
      onClick={
        onClick
          ? (event) => {
              if (
                hit(event.localCol, event.localRow) &&
                hit(event.pressLocalCol, event.pressLocalRow)
              )
                onClick(event);
            }
          : undefined
      }
    >
      <ThemedText {...props} ref={text} />
    </Box>
  );
}
