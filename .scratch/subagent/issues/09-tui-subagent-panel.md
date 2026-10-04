# 09: TUI 子代理面板

**What to build:** 输入框上方 todo 面板下方新增子代理面板，复用 todo 面板的结构、样式和工单 01 的高度预算：

- root 行 `▸/▾ 子代理 running/total`，hover 背景同 todo；点 root 切换折叠，折叠状态独立于 todo，不和 Ctrl+Q 共用。
- 节点每行：状态符号、`[type]`、description；点节点进入详情页。
- 空闲时隐藏已结束的节点，全部隐藏时面板不渲染。
- 折叠时只显示第一个 running 节点作预览。
- 与 todo 面板平分剩余高度，一方为空时另一方用全部；空间不够时折叠成 1 行预览。审批框 / 提问框打开时仍显示。

**Blocked by:** 01, 08

**Status:** resolved

Implementing in `codex/subagent-09-panel` at `/Users/artorias_chan/.codex/worktrees/subagent-09-panel/Neant`. Public terminal/model seams follow the approved spec.

参考：[spec](../spec.md)「TUI」中的「子代理面板」「面板顺序」。

- [x] TUI e2e：有 running 子代理时面板出现在 todo 面板下方
- [x] TUI e2e：点 root 折叠 / 展开，todo 面板折叠状态不变；Ctrl+Q 不影响子代理面板
- [x] TUI e2e：点节点进入详情页
- [x] TUI e2e：空闲时隐藏已结束项；审批框打开时两个面板同时显示；小高度下各自折叠成预览
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

Implementation uses a props-only `SubagentPanel`, theme-aware Todo panel parts, independent Chat folding state, existing `openDetail(id, chat)` navigation, and the shared remaining-row allocator. Settled children hide only once the parent Run becomes idle; restored idle children remain visible. Compact inline previews retain a separate node click target.

Public-terminal TDD evidence:

- Missing panel header RED: `/tmp/neant-09-red-panel.log` (0 pass, 1 fail).
- 12-row permission budget RED: `/tmp/neant-09-red-dialog.log` exposes clipped StatusLine; only the permission bottom gap compacts when required, matching the actual row reservation.
- Compact preview click RED: `/tmp/neant-09-red-preview.log` (detail did not open).
- Panel GREEN: `/tmp/neant-09-green-complete.log` (14 pass, 0 fail, 124 assertions): independent hover/mouse/Ctrl+Q folding, normal and compact node navigation, settled/idle/resume visibility, equal panel shares and empty-panel capacity, permission/question coexistence at 40/60/80 columns by 12 rows and 60 columns by 24 rows, usable choices, CJK draft round-trip and fixed status.
- Targeted Todo/panel/subagent views: `/tmp/neant-09-targeted-check.log` (38 pass, 0 fail, 280 assertions). The existing 16-row eight-child streaming fixture now fills the card protocol's three output lines, so its streamed tail stays visible above the new dock panel; parent final reply and all eight completion-notification assertions remain intact.
- `rtk proxy bunx tsc -b` passed during each implementation slice.

Full acceptance: `rtk proxy env -u NO_COLOR bun run check` exited 0; formatting, lint, `tsc -b`, knip and full tests passed (1101 pass, 0 fail, 6042 assertions, 82 files, 123.83s), `/tmp/neant-09-full-check.log`.

Two-axis review passed against `c08058e1595ff0fb9b4f0464bfb5a2e92702c6e1...bf178281d2cd0882b99116399350636b4bf58a81`: Standards 0 findings (independent targeted run: 38 pass, 0 fail, 280 assertions); Spec 0 findings (independent panel run: 14 pass, 0 fail, 124 assertions). Root handles main integration, final main acceptance and managed-worktree cleanup.

## Answer

Delivered the independent, clickable Subagent panel below Todo, with shared height budgeting and complete public-terminal acceptance. See the implementation and verification evidence above.
