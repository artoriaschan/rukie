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
import type { TodoItem } from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { Box, ThemedText } from "@neant/tui";
import { createTuiI18n } from "../../i18n";

export function GoalTodoPanel({
  todos,
  working,
  locale = "zh",
  maxHeight = 11,
}: {
  todos: readonly TodoItem[];
  working: boolean;
  locale?: Locale;
  maxHeight?: number;
}) {
  const t = createTuiI18n(locale);
  const remaining = working ? todos : todos.filter((todo) => todo.status !== "completed");
  if (remaining.length === 0) return null;
  const done = todos.filter((todo) => todo.status === "completed").length;
  const paddingTop = maxHeight >= 4 ? 1 : 0;
  const rowBudget = Math.max(1, maxHeight - paddingTop);
  const overflow = remaining.length > Math.min(8, rowBudget - 1);
  const limit = Math.max(0, Math.min(8, rowBudget - 1 - Number(overflow)));
  const visible = remaining.slice(0, limit);
  const hidden = remaining.length - visible.length;
  return (
    <Box flexDirection="column" paddingX={2} paddingTop={paddingTop}>
      {/* The Todo section hangs below the future Goal root row. */}
      <Box flexDirection="column">
        <Box height={1}>
          <ThemedText dimColor wrap="truncate">{`▾ ✓ ${done}/${todos.length}`}</ThemedText>
        </Box>
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
            </ThemedText>
          </Box>
        )}
      </Box>
    </Box>
  );
}
