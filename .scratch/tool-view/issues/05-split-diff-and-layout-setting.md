# 05: split diff 与 diffLayout 设置

**What to build:** 宽终端上 diff 以左右分栏呈现，用户可用 `diffLayout` 设置强制 unified 或 split。见 [spec](../spec.md) 的「设置」与「渲染组件」。

Blocked by: 04

Status: resolved

- [x] 用户设置新增 `diffLayout: auto | unified | split`，默认 `auto`，按现有 settings schema 校验
- [x] `auto` 下终端宽度 ≥110 列用 split，否则 unified；resize 跨阈值时切换
- [x] split 两栏按 `diff` 包对齐，带词级高亮，长行截断不换行
- [x] `unified` / `split` 强制值生效
- [x] TUI e2e 覆盖阈值、resize 切换与强制值；小终端不破坏布局

## Implementation and verification

- User `diffLayout` is schema-validated (`auto | unified | split`), defaults to auto in a frontend-only provider, and reaches every ToolCall including resumed/child views. `auto` observes terminal resize and switches at 110 columns; explicit values retain their layout.
- Renderer design system owns `alignSplitDiff` and `SplitDiffView`. Prelexed unified facts retain multi-file and hunk boundaries, syntax colors and patch-only support. Equal replacement blocks align by index; unequal blocks use diffLines case-insensitive shared rows so insertions do not shift edits. Word changes use diffWordsWithSpace and distinct add/delete backgrounds while shared tokens keep syntax colors. Fixed-width panes clip source lines. Source/path hitboxes exclude blank columns; path callbacks carry only a fact and never execute host actions.
- Public TUI red/green tests cover default threshold and resize in both directions, forced settings at 120/80 columns, word background and shared syntax terminal-cell colors, unequal replacement alignment, long-line clipping, 40-column split folding and click expansion, blank-cell click exclusion, 12-column resize, invalid settings rejection before Session creation, and resumed large patch-only multi-hunk output.
- `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/split-diff.test.ts apps/neant-tui/tests/e2e/file-diff.test.ts apps/neant-tui/tests/e2e/tool-syntax.test.ts apps/neant-tui/tests/e2e/tool-expansion.test.ts`: 17 passed, 60 assertions, 2.42s. New scenarios took 4–244ms; no new fixed waits or scenario over one second.
- `bun run check:dev` and `git diff --check` passed. The integration owner runs the final aggregate check once after all tickets merge.
- Updated renderer/API README, TUI settings usage, exact pinned diff dependency and Bun lockfile. Ticket09 can pass its path callback directly to SplitDiffView; path click takes precedence over card toggle.

- Synced integration `3f716e9` (ticket03), preserving dedicated rows and frontend provider inheritance for child ToolCalls. Post-sync `check:dev` passed; focused split/plan/subagent tests: 32 passed, 141 assertions, 4.93s. The merge changed only import placement where overlapping; no presentation behavior was discarded.
