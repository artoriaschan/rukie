# 11: transcript 搜索

**What to build:** 在 transcript 模式下用户按 `/` 搜索整段对话，`n` / `N` 在匹配间跳转；退出后输入框的 `/` 命令补全照常工作。见 [spec](../spec.md) 的「TUI 工具卡」按键部分。

**Blocked by:** 02

**Status:** resolved

- [x] transcript 模式下 `/` 进入搜索输入，回车后高亮匹配并跳到第一处
- [x] `n` / `N` 前后跳转，无匹配时显示提示
- [x] Esc 或 `ctrl+o` 退出 transcript 模式，按键交回输入框，`/` 恢复为命令补全
- [x] run 中可进入
- [x] zh / en 文案
- [x] TUI e2e 覆盖搜索、跳转、退出后 `/` 行为与阅读位置

## Implementation and verification

- Literal, case-insensitive search reads the complete main conversation presentation source: messages, thinking, question/notice/plan-review records, displayed subagent summaries, typed tool titles and full bodies/diffs, terminal verdicts, context snapshots and retained JobCard headings/tails. Card presentation helpers are shared by rendering and search; arbitrary protocol metadata and background spill files are not scanned.
- Ctrl+O enters the expanded transcript; `/` opens a separate query editor, Enter highlights and jumps, `n`/`N` wrap occurrences, no matches have zh/en feedback. Esc/Ctrl+O preserve the composer draft and current reading position. Existing file-menu/Interaction/panel guards remain ahead of transcript keys.
- Tool output is searchable beyond its 400-row render window; active source rows shift that bounded window. CommonMark parser source positions map styled Markdown matches back to source rows, and navigation counts occurrences in the current window. Renderer text styling preserves Markdown/syntax spans, and stable text anchors pause following without changing terminal restoration.
- Red evidence: the initial `/needle` reached the composer and started an unwanted Run; repeated read matches at lines 5/450/495 did not navigate. Markdown source at lines 6/460 reproduced a jump to paragraph 60 before source mapping. Context and JobCard-only headings reproduced no-match before their owning projections were added.
- Green public `start`/headless terminal coverage: all 9 search cases pass, including RGB highlight, repeated >400-row matches, split old/new matches on one row, >480-character title, bold Markdown source mapping, displayed context and background headings, during-Run zh/en, draft/slash restoration, and streaming reading anchors. Individual cases 62–274 ms in the final run. New timers have no fixed waits; the background test uses real child output and completion predicates to cover delivery.
- After merging integration `cf8d58e`, focused search/context/background verification: 27 pass / 189 assertions / 9.76 s. The two unchanged background process cases take 2.16/3.28 s; own tests remain below one second. Focused diff/web/tooltip/reveal/file-actions/expansion/scroll verification: 46 pass / 170 assertions / 5.63 s.
- `bunx --no -- oxfmt --check`, `bunx --no -- oxlint`, `bunx --no -- tsc -b`, `bunx --no -- knip`, and `git diff --check` pass (all via RTK). Aggregate validation remains the integration owner's single final gate.

### Review 修复验证（2026-10-07）

- 共享 completedEntryVisible 投影排除同一 Subagent 的旧 continuation 行。公开 headless continuation 搜索从 3 个（含不可见项）修正为 2 个可见匹配；legacy edit 原始结果搜索与 notices projection 一致。transcript-search/subagent-card 回归通过。
- `bun run check:dev` 通过；最终 aggregate 在 integration branch 统一执行，结果由 spec 验证记录补充。
