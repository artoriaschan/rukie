# 09: TUI 子代理面板

**What to build:** 输入框上方 todo 面板下方新增子代理面板，复用 todo 面板的结构、样式和工单 01 的高度预算：

- root 行 `▸/▾ 子代理 running/total`，hover 背景同 todo；点 root 切换折叠，折叠状态独立于 todo，不和 Ctrl+Q 共用。
- 节点每行：状态符号、`[type]`、description；点节点进入详情页。
- 只有真实 running 子代理时展示面板；恢复出的 idle 身份只保留在 dashboard / 详情。全部子代理结束即收起，即使父 Run 仍在工作；隐藏时不预留高度。
- 折叠时只显示第一个 running 节点作预览。
- 与 todo 面板平分剩余高度，一方为空时另一方用全部；空间不够时折叠成 1 行预览。审批框 / 提问框打开时仍显示。

Blocked by: 01, 08

Status: resolved

Implementing in `codex/subagent-09-panel` at `/Users/artorias_chan/.codex/worktrees/subagent-09-panel/Neant`. Public terminal/model seams follow the approved spec.

参考：[spec](../spec.md)「TUI」中的「子代理面板」「面板顺序」。

- [x] TUI e2e：有 running 子代理时面板出现在 todo 面板下方
- [x] TUI e2e：点 root 折叠 / 展开，todo 面板折叠状态不变；Ctrl+Q 不影响子代理面板
- [x] TUI e2e：点节点进入详情页
- [x] TUI e2e：全部子代理结束即收起；resume 历史不占 dock 高度，dashboard / 继续运行保留；审批框打开时两个活跃面板同时显示；小高度下各自折叠成预览
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

Historical 09 implementation (visibility superseded by the 2026-10-05 correction below): uses a props-only `SubagentPanel`, theme-aware Todo panel parts, independent Chat folding state, existing `openDetail(id, chat)` navigation, and the shared remaining-row allocator. Settled children hide only once the parent Run becomes idle; restored idle children remain visible. Compact inline previews retain a separate node click target.

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

### 2026-10-05 resume visibility correction

User clarified that the automatic list should disappear after all children finish. Chat now derives one panel list from actual running child evidence for both rendering and height allocation. Restored idle identities stay in the dashboard and Core list_agents / send_message; parent work alone cannot reopen the dock. Completed, failed and aborted final children close it immediately, while a running sibling retains settled context. Public resume and Rewind tests replace the superseded historical-idle dock expectations.

Verification for the 2026-10-05 correction (frozen implementation `1614383e9639d79f544f26f0634882e1f495d7de`, baseline `8d3207c9e9460a9539311a1483e789b91da2cb01`):

- Initial public resume RED: `/tmp/neant-resume-subagent-panel-red.log`, 0 pass / 1 fail. Replaying the expanded new contracts against the baseline product source: `/tmp/neant-resume-subagent-panel-regression-red.log`, 0 pass / 6 fail.
- Public focused GREEN: `env -u NO_COLOR bun test` over Subagent panel, dashboard / detail, child interactions, Todo panel and Rewind: 94 pass / 0 fail, 539 assertions, 5 files; `/tmp/neant-resume-subagent-panel-focused.log`. Includes completed / failed / aborted final children while the parent still works; resume without child model calls; English historical dashboard / idle detail; ordinary parent prompt and `list_agents`; actual cold `send_message`; Todo regaining eight visible rows; sibling / parent waiting; real conversation Rewind and 40×12 file-only Rewind; original permission / question coexistence remains covered.
- `bunx tsc -b` passed. The first focused invocation inherited `NO_COLOR` and failed six existing color-cell assertions; removing that environment switch passed without changing source or assertions.
- Full acceptance ran once after the frozen implementation commit with an isolated temporary HOME: `env -u NO_COLOR caffeinate -is bun run check`, exit 0; format, lint, typecheck, knip and all tests passed: 1567 pass / 0 fail, 8112 assertions, 114 files, 190.76s. Log: `/tmp/neant-resume-subagent-panel-fullcheck.log`. Temporary HOME was removed afterward.
- Independent two-axis review of `8d3207c...1614383`: Standards 0 findings, Spec 0 findings. Both read the frozen diff without edits or redundant test runs. This final evidence update changes docs only; product and tests stay byte-identical to the checked commit. Parent handles main integration and managed worktree / branch cleanup.
