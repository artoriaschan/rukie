/**
 * Adapted from dsh-TUI src/components/questions/AskUserQuestionPanel.tsx and QuestionMinimizedBar.tsx.
 *
 * MIT License
 *
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
import { useEffect, useState } from "react";
import { Box, Divider, ThemedBox, ThemedText, ThemedTextInput } from "@neant/tui";
import type { Question } from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";

const singleLine = (text: string) => text.replace(/[\r\n]+/g, " ");
const wrappedRows = (text: string, width: number) =>
  Bun.wrapAnsi(text, width)
    .split("\n")
    .reduce((rows, line) => rows + Math.max(1, Math.ceil(Bun.stringWidth(line) / width)), 0);

export function QuestionDialog({
  question,
  questionIndex,
  questionCount,
  answeredCount,
  selected,
  checked,
  custom,
  cursor,
  attached,
  error,
  collapsed,
  onToggle,
  onSelect,
  onOption,
  onSubmit,
  maxHeight,
  columns,
  locale,
}: {
  question: Question;
  questionIndex: number;
  questionCount: number;
  answeredCount: number;
  selected: number;
  checked: number[];
  custom: string;
  cursor: number;
  attached?: number;
  error?: "select" | "custom" | "paste" | "clipboard";
  collapsed: boolean;
  onToggle(): void;
  onSelect(index: number): void;
  onOption(index: number): void;
  onSubmit(): void;
  maxHeight: number;
  columns: number;
  locale: Locale;
}) {
  const t = createTuiI18n(locale);
  const [hovered, setHovered] = useState<number>();
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    if (!collapsed) return;
    const timer = setInterval(() => setBlink((value) => !value), 500);
    return () => clearInterval(timer);
  }, [collapsed]);
  const remaining = questionCount - answeredCount;
  const heading =
    " " +
    t("question.heading", {
      current: questionIndex + 1,
      total: questionCount,
      remaining: remaining > 1 ? t("question.remaining", { count: remaining }) : "",
    }) +
    " ";
  if (collapsed)
    return (
      <Box flexDirection="column" paddingX={2} marginTop={maxHeight >= 3 ? 1 : 0}>
        <ThemedBox
          height={1}
          onClick={onToggle}
          onMouseEnter={() => setHovered(-1)}
          onMouseLeave={() => setHovered(undefined)}
          backgroundColor={hovered === -1 ? "badgeHoverBackground" : undefined}
        >
          <ThemedText wrap="truncate">
            <ThemedText dimColor>{`▸ ${heading} `}</ThemedText>
            {question.question.split("\n")[0]?.replace(/\s+/gu, " ").trim()}
          </ThemedText>
        </ThemedBox>
        <ThemedText wrap="truncate">
          {blink ? "⏸ " : "  "}
          <ThemedText dimColor>{`${t("question.waiting")} — ${t("question.expand")}`}</ThemedText>
        </ThemedText>
      </Box>
    );
  const width = Math.max(1, columns - 4);
  const inputFocused = selected === question.options.length;
  const canSubmit = question.multiSelect && (checked.length > 0 || custom.trim().length > 0);
  const customLabel =
    t("question.custom") +
    (!question.multiSelect && attached !== undefined
      ? t("question.attached", { label: singleLine(question.options[attached]!.label) })
      : "") +
    "：";
  const prefixWidth = Math.min(Math.max(1, width - 8), Bun.stringWidth(customLabel));
  const fullHints = [
    t(inputFocused ? "question.hint.type" : "question.hint.select"),
    ...(!inputFocused && question.multiSelect ? [t("question.hint.multi")] : []),
    t("question.hint.paste"),
    ...(!inputFocused ? [t("question.hint.attach")] : []),
    t("question.hint.enter"),
    ...(inputFocused ? [t("question.hint.back")] : []),
    t(questionIndex > 0 ? "question.hint.previous" : "question.hint.escape"),
    ...(questionCount > 1 ? [t(inputFocused ? "question.hint.edge" : "question.hint.switch")] : []),
    ...(questionIndex > 0 ? [t("question.hint.cancel")] : []),
    ...(question.multiSelect && checked.length > 0
      ? [t("question.hint.selected", { count: checked.length })]
      : []),
    t("question.hint.fold"),
  ].join(" · ");
  const fullQuestionHeight = wrappedRows(question.question, width);
  const fullHintHeight = wrappedRows(fullHints, width);
  const fullReserved =
    1 +
    Number(Boolean(question.header)) +
    fullQuestionHeight +
    1 +
    fullHintHeight +
    Number(Boolean(error)) * 2 +
    Number(canSubmit) * 2 +
    4 +
    Number(inputFocused);
  const spacious = maxHeight >= fullReserved + 2;
  const gap = Number(spacious);
  const chipHeight = question.header && (!error || maxHeight > 6) ? 1 : 0;
  const questionHeight = spacious ? fullQuestionHeight : 1;
  const hintHeight = spacious ? fullHintHeight : 1;
  const errorHeight = error ? 1 + gap : 0;
  const submitHeight = spacious && canSubmit ? 1 + gap : 0;
  const hints = spacious
    ? fullHints
    : t(questionCount > 1 ? "question.hint.compact-batch" : "question.hint.compact");
  const reserved =
    Number(spacious && inputFocused) +
    1 +
    chipHeight +
    questionHeight +
    1 +
    hintHeight +
    errorHeight +
    submitHeight +
    gap * 4;
  const budget = Math.max(1, maxHeight - reserved);
  const optionHeights = question.options.map(
    (option) =>
      wrappedRows(option.label, width - 3) +
      (option.description ? wrappedRows(option.description, width - 3) : 0),
  );
  const windowed = !spacious || optionHeights.reduce((sum, height) => sum + height, 0) + 1 > budget;
  const rowHeight = budget >= question.options.length * 2 ? 2 : 1;
  const visibleCount = windowed
    ? Math.min(question.options.length, Math.max(1, Math.floor(budget / rowHeight)))
    : question.options.length;
  const focus = Math.min(selected, question.options.length - 1);
  const first = Math.max(
    0,
    Math.min(focus - Math.floor(visibleCount / 2), question.options.length - visibleCount),
  );
  return (
    <Box flexDirection="column" paddingX={2} marginTop={gap}>
      <ThemedBox
        height={1}
        onClick={onToggle}
        onMouseEnter={() => setHovered(-1)}
        onMouseLeave={() => setHovered(undefined)}
        backgroundColor={hovered === -1 ? "badgeHoverBackground" : undefined}
      >
        <Divider title={`▾${heading}`} color="permission" />
      </ThemedBox>
      <Box flexDirection="column" marginTop={gap}>
        {chipHeight > 0 && (
          <Box height={1}>
            <ThemedText
              bold
              color="permission"
              wrap="truncate"
            >{`◈ ${singleLine(question.header)}`}</ThemedText>
          </Box>
        )}
        <Box height={questionHeight}>
          <ThemedText bold wrap={spacious ? "wrap" : "truncate"}>
            {spacious ? question.question : singleLine(question.question)}
          </ThemedText>
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={gap}>
        {question.options.slice(first, first + visibleCount).map((option, offset) => {
          const index = first + offset;
          const focused = selected === index;
          const active = question.multiSelect ? checked.includes(index) : focused;
          return (
            <ThemedBox
              key={index}
              height={windowed ? rowHeight : optionHeights[index]}
              marginTop={!windowed && focused ? 1 : 0}
              onClick={() => onOption(index)}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(undefined)}
              backgroundColor={hovered === index && !focused ? "badgeHoverBackground" : undefined}
            >
              <Box width={1}>
                <ThemedText color={focused ? "accent" : undefined} bold={focused}>
                  {focused
                    ? "❯"
                    : index === first && first > 0
                      ? "↑"
                      : offset === visibleCount - 1 && index < question.options.length - 1
                        ? "↓"
                        : " "}
                </ThemedText>
              </Box>
              <Box width={1}>
                <ThemedText color={focused ? "accent" : undefined} bold={active}>
                  {question.multiSelect ? (active ? "◉" : "○") : focused ? "●" : "○"}
                </ThemedText>
              </Box>
              <Box flexDirection="column" marginLeft={1} flexGrow={1}>
                <ThemedText
                  bold={focused || active}
                  color={focused ? "accent" : undefined}
                  wrap={windowed ? "truncate" : "wrap"}
                >
                  {windowed ? singleLine(option.label) : option.label}
                </ThemedText>
                {(!windowed || rowHeight > 1) && option.description && (
                  <ThemedText dimColor wrap={windowed ? "truncate" : "wrap"}>
                    {windowed ? singleLine(option.description) : option.description}
                  </ThemedText>
                )}
              </Box>
            </ThemedBox>
          );
        })}
        <ThemedBox
          height={1}
          marginTop={spacious && inputFocused ? 1 : 0}
          onClick={() => onSelect(question.options.length)}
          backgroundColor={
            hovered === question.options.length && !inputFocused
              ? "badgeHoverBackground"
              : undefined
          }
          onMouseEnter={() => setHovered(question.options.length)}
          onMouseLeave={() => setHovered(undefined)}
        >
          <Box width={1}>
            <ThemedText color="accent" bold={inputFocused}>
              {inputFocused ? "❯" : " "}
            </ThemedText>
          </Box>
          <Box width={1}>
            <ThemedText color={inputFocused ? "accent" : "permission"}>✎</ThemedText>
          </Box>
          <Box marginLeft={1} width={prefixWidth} flexShrink={0}>
            <ThemedText wrap="truncate">
              <ThemedText bold={inputFocused} color={inputFocused ? "accent" : "permission"}>
                {t("question.custom")}
              </ThemedText>
              {!question.multiSelect && attached !== undefined && (
                <ThemedText color="permission">
                  {t("question.attached", { label: singleLine(question.options[attached]!.label) })}
                </ThemedText>
              )}
              <ThemedText dimColor>：</ThemedText>
            </ThemedText>
          </Box>
          {!custom && !inputFocused ? (
            <>
              <ThemedTextInput
                value=""
                onChange={() => {}}
                readOnly
                cursorOffset={0}
                columns={1}
                maxLines={1}
              />
              <ThemedText dimColor wrap="truncate">
                {t("question.placeholder")}
              </ThemedText>
            </>
          ) : (
            <ThemedTextInput
              value={inputFocused ? custom : custom.slice(0, cursor) + "▏" + custom.slice(cursor)}
              onChange={() => {}}
              readOnly
              cursorOffset={cursor}
              cursorStyle={inputFocused ? "block" : undefined}
              columns={Math.max(1, width - 3 - prefixWidth)}
              maxLines={1}
            />
          )}
        </ThemedBox>
        {submitHeight > 0 && (
          <ThemedBox
            height={1}
            marginTop={gap}
            onClick={onSubmit}
            onMouseEnter={() => setHovered(-2)}
            onMouseLeave={() => setHovered(undefined)}
            backgroundColor={hovered === -2 ? "badgeHoverBackground" : undefined}
          >
            <Box width={2}>
              <ThemedText color="accent">✓</ThemedText>
            </Box>
            <ThemedText dimColor>{t("question.submit")}</ThemedText>
          </ThemedBox>
        )}
      </Box>
      {error && (
        <Box height={1} marginTop={gap}>
          <ThemedText color="error" wrap="truncate">
            {t(`question.error.${error}`, { count: 8000 })}
          </ThemedText>
        </Box>
      )}
      <Box height={hintHeight} marginTop={gap}>
        <ThemedText dimColor wrap={spacious ? "wrap" : "truncate"}>
          {hints}
        </ThemedText>
      </Box>
    </Box>
  );
}
