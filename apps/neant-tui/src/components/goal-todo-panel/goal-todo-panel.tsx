/**
 * Adapted from dsh-TUI src/components/GoalTodoPanel.tsx.
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
import type { GoalView, TodoItem } from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { useEffect, useRef, useState } from "react";
import { Box, ThemedBox, ThemedText } from "@neant/tui";
import { createTuiI18n } from "../../i18n";

export function GoalTodoPanel({
  goal,
  todos,
  working,
  collapsed,
  onToggle,
  locale = "zh",
  maxHeight = 12,
}: {
  goal?: GoalView;
  todos: readonly TodoItem[];
  working: boolean;
  collapsed: boolean;
  onToggle(): void;
  locale?: Locale;
  maxHeight?: number;
}) {
  const [headerHovered, setHeaderHovered] = useState(false);
  const start = useRef<{ id: string; at: number } | undefined>(undefined);
  if (goal && start.current?.id !== goal.id) start.current = { id: goal.id, at: Date.now() };
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!goal || goal.phase === "complete") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [goal?.id, goal?.phase]);
  const seconds = Math.max(0, Math.floor((now - (start.current?.at ?? now)) / 1000));
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
  const color =
    goal?.phase === "active"
      ? "success"
      : goal?.phase === "paused"
        ? "warning"
        : goal?.phase === "blocked"
          ? "error"
          : undefined;
  const glyph = goal && { active: "●", paused: "⏸", blocked: "⛔", complete: "✓" }[goal.phase];
  const t = createTuiI18n(locale);
  const remaining = working ? todos : todos.filter((todo) => todo.status !== "completed");
  if (!goal && remaining.length === 0) return null;
  const done = todos.filter((todo) => todo.status === "completed").length;
  const preview =
    todos.find((todo) => todo.status === "in_progress") ??
    todos.find((todo) => todo.status !== "completed");
  const rootHeight = goal ? 1 + Number(goal.phase === "blocked") : 0;
  const todoHeight = Math.max(1, maxHeight - rootHeight);
  const compact = todoHeight < 3;
  const folded = collapsed || compact;
  const paddingTop = todoHeight >= 4 ? 1 : 0;
  const rowBudget = compact ? 1 : Math.max(1, todoHeight - paddingTop);
  // Short viewports share the overflow row with the hint to keep the input visible.
  const hintHeight = !folded && rowBudget >= 3 ? 1 : 0;
  const listBudget = rowBudget - hintHeight;
  const overflow = !folded && (remaining.length > Math.min(8, listBudget - 1) || rowBudget < 3);
  const limit = Math.max(0, Math.min(8, listBudget - 1 - Number(overflow)));
  const visible = folded ? (preview && rowBudget >= 2 ? [preview] : []) : remaining.slice(0, limit);
  const hidden = folded ? 0 : remaining.length - visible.length;
  return (
    <Box flexDirection="column" paddingX={2} paddingTop={paddingTop}>
      {goal && (
        <Box flexDirection="column" flexShrink={0}>
          <Box height={1} flexDirection="row">
            <Box width={3} flexShrink={0}>
              <ThemedText color="suggestion">🎯</ThemedText>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <ThemedText bold wrap="truncate">
                {goal.objective.replace(/[\r\n]+/g, " ")}
              </ThemedText>
            </Box>
            <Box marginLeft={1} flexShrink={0}>
              <ThemedText color={color} dimColor={goal.phase === "complete"} wrap="truncate">
                {`${glyph} ${goal.phase} · ${goal.roundsStarted}/${goal.maxRounds} · ${elapsed}`}
              </ThemedText>
            </Box>
          </Box>
          {goal.phase === "blocked" && (
            <Box height={1}>
              <ThemedText
                color="error"
                wrap="truncate"
              >{`│ ${goal.blockedReason?.replace(/[\r\n]+/g, " ")}`}</ThemedText>
            </Box>
          )}
        </Box>
      )}
      <Box flexDirection="column">
        <ThemedBox
          height={1}
          onClick={onToggle}
          onMouseEnter={() => setHeaderHovered(true)}
          onMouseLeave={() => setHeaderHovered(false)}
          backgroundColor={headerHovered ? "badgeHoverBackground" : undefined}
        >
          <ThemedText dimColor wrap="truncate">
            {`${folded ? "▸" : "▾"} ✓ ${done}/${todos.length}`}
            {compact && preview
              ? `  ${preview.status === "in_progress" ? "●" : "○"} ${preview.content.replace(/[\r\n]+/g, " ")}`
              : ""}
          </ThemedText>
        </ThemedBox>
        {visible.map((todo, index) => (
          <Box key={index} height={1}>
            <ThemedText wrap="truncate" dimColor={todo.status === "completed"}>
              <ThemedText dimColor>
                {index === visible.length - 1 && hidden === 0 ? "└─ " : "├─ "}
              </ThemedText>
              <ThemedText
                color={todo.status === "in_progress" ? "accent" : undefined}
                dimColor={todo.status !== "in_progress"}
              >
                {todo.status === "in_progress" ? "● " : todo.status === "completed" ? "✓ " : "○ "}
              </ThemedText>
              {todo.content.replace(/[\r\n]+/g, " ")}
            </ThemedText>
          </Box>
        ))}
        {hidden > 0 && rowBudget >= 2 && (
          <Box height={1}>
            <ThemedText dimColor wrap="truncate">
              {`└─ ${t("todo.more", { count: hidden })}`}
              {hintHeight === 0 ? `  ${t("todo.fold")}` : ""}
            </ThemedText>
          </Box>
        )}
        {hintHeight > 0 && (
          <Box height={1}>
            <ThemedText dimColor wrap="truncate">{`  ${t("todo.fold")}`}</ThemedText>
          </Box>
        )}
      </Box>
    </Box>
  );
}
