/**
 * Adapted from dsh-TUI src/components/CommandSuggestions.tsx and SuggestionCard.tsx.
 *
 * MIT License
 * Copyright (c) 2026, chimney (ccch1mneyyy)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { useState } from "react";
import { Box, ThemedBox, ThemedText, type BoxProps } from "../../../ink/index.ts";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function truncate(text: string, width: number) {
  if (Bun.stringWidth(text) <= width) return text;
  if (width < 1) return "";
  let result = "";
  for (const { segment } of graphemes.segment(text)) {
    if (Bun.stringWidth(result + segment) > width - 1) break;
    result += segment;
  }
  return result + "…";
}

/** An overlay anchored to the prompt's top edge; maxHeight includes its borders and footer. */
export function CommandSuggestions({
  items,
  selected,
  maxHeight,
  columns,
  query,
  locale,
  planMode,
  onPick,
  onWheel,
}: {
  items: readonly { name: string; description: string; skill?: boolean }[];
  selected: number;
  maxHeight: number;
  columns: number;
  query: string;
  locale: Locale;
  planMode: boolean;
  onPick(index: number): void;
  onWheel: BoxProps["onWheel"];
}) {
  const [hovered, setHovered] = useState<number>();
  if (!items.length || maxHeight < 3) return null;
  const t = createTuiI18n(locale);
  const count = Math.min(
    5,
    items.length,
    maxHeight - 2 - Number(items.length > Math.min(5, maxHeight - 2)),
  );
  if (count < 1) return null;
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), items.length - count));
  const above = start;
  const below = items.length - start - count;
  const footer = [above > 0 ? `↑${above}` : "", below > 0 ? `↓${below}` : ""]
    .filter(Boolean)
    .join(" · ");
  const height = count + 2 + Number(!!footer);
  const inner = Math.max(0, columns - 2);
  const usable = Math.max(0, columns - 4);
  const nameWidth = Math.min(
    Math.max(...items.map((item) => Bun.stringWidth(item.name))) + 5,
    Math.floor(usable * 0.4),
  );
  const token = query.replace(/^\//, "").match(/[^ \t]*$/)?.[0] ?? "";
  const lead = `─ ${t("command.menu-title")} · ${t("command.menu-count", { count: items.length })} `;
  const top =
    Bun.stringWidth(lead) + 1 <= inner
      ? `╭${lead}${"─".repeat(inner - Bun.stringWidth(lead))}╮`
      : `╭${"─".repeat(inner)}╮`;
  const border = planMode ? "plan" : "promptBorder";
  return (
    <Box
      position="absolute"
      top={-height}
      left={0}
      width={columns}
      height={height}
      flexDirection="column"
      onWheel={onWheel}
    >
      <ThemedText color={border} wrap="truncate">
        {top}
      </ThemedText>
      {items.slice(start, start + count).map((item, offset) => {
        const focused = start + offset === selected;
        const tag = item.skill ? "[skill] " : "";
        const description = truncate(
          item.description.replace(/[\r\n]+/g, " "),
          Math.max(0, usable - 3 - nameWidth - Bun.stringWidth(tag)),
        );
        const padding = " ".repeat(Math.max(0, nameWidth - Bun.stringWidth(item.name)));
        const match =
          token && item.name.toLowerCase().startsWith(token.toLowerCase()) ? token.length : 0;
        return (
          <Box
            key={offset}
            height={1}
            width={columns}
            onClick={() => onPick(start + offset)}
            onMouseEnter={() => setHovered(offset)}
            onMouseLeave={() => setHovered(undefined)}
          >
            <ThemedText color={border}>│</ThemedText>
            <ThemedBox
              width={inner}
              backgroundColor={hovered === offset ? "badgeHoverBackground" : undefined}
            >
              <ThemedText wrap="truncate">
                {" "}
                {focused ? (
                  <ThemedText color="suggestion" bold>{`❯ ${item.name}${padding}`}</ThemedText>
                ) : (
                  <>
                    <ThemedText color="inactive">{"  "}</ThemedText>
                    {match > 0 && <ThemedText>{item.name.slice(0, match)}</ThemedText>}
                    <ThemedText color="inactive">{item.name.slice(match) + padding}</ThemedText>
                  </>
                )}
                {tag && <ThemedText color="inactive">{tag}</ThemedText>}
                <ThemedText color={focused ? "suggestion" : "inactive"}>{description}</ThemedText>
                {" ".repeat(inner)}
              </ThemedText>
            </ThemedBox>
            <ThemedText color={border}>│</ThemedText>
          </Box>
        );
      })}
      {footer && (
        <Box height={1} width={columns}>
          <ThemedText color={border}>│</ThemedText>
          <Box width={inner}>
            <ThemedText
              color="inactive"
              wrap="truncate"
            >{` ${footer}${" ".repeat(inner)}`}</ThemedText>
          </Box>
          <ThemedText color={border}>│</ThemedText>
        </Box>
      )}
      <ThemedText color={border} wrap="truncate">{`╰${"─".repeat(inner)}╯`}</ThemedText>
    </Box>
  );
}
