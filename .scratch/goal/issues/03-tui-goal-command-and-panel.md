# 03: TUI `/goal` 与面板

**What to build:** TUI 用户可以用 `/goal` 系列子命令设定、查看、修改、暂停、恢复、清除 goal。输入框上方面板显示 🎯 根行（PhaseBadge、轮次、计时，blocked 时显示原因），statusline 最前面显示 phase chip，goal 的 round 消息和收尾消息不出现在对话里。界面复刻 dsh-TUI。详见 [Goal spec](../spec.md) 的 TUI 各节。

**Blocked by:** 01 Goal 续跑核心

**Status:** resolved

- [x] `/goal` 文法：`/goal`、`/goal <objective>`、`/goal edit <objective>`、`/goal pause|resume|clear`（控制字不区分大小写，其他任意文本视为 objective），替换 Slash Command 框架里的占位
- [x] run 中只有查看、pause、clear 可用，其余提示"仅空闲可用"；Session API 抛的错渲染为 error notice
- [x] 查看命令的 notice 输出 Status、Blocker、Objective、Rounds、Activation，以及按当前状态给出的命令提示（照 DSH `commandHint`）
- [x] 补全菜单中 `/goal` 带参数提示
- [x] `goal-todo-panel` 根行复刻 dsh-TUI：`🎯` + bold truncate 的 objective，右侧 PhaseBadge `<label> · n/max · <elapsed>`，phase 配色；本地计时器在 complete 时冻结；blocked 时多一行 `│ <reason>`
- [x] goal 存在时 todo 区块常显；goal 与 todo 都没有时整块隐藏；`ctrl+q` 折叠时根行仍可见
- [x] statusline 最前显示 chip `<glyph> n/max`，按 phase 着色；无 goal 时不显示
- [x] 带 goal 来源标记的消息在 live 与回放中都不渲染为用户气泡
- [x] 收到 `tool_state_changed(goal)` 或 run 结束时刷新；resume 后立即显示 goal 状态
- [x] 新文案中英两份
- [x] TUI 测试覆盖 spec Testing Decisions 入口 2（工具卡除外）

## Comments

- Claimed on `codex/goal-03` from verified integration base `21a97c2`. Public test seam: TUI `start()` with controlled model and headless terminal, as confirmed in Goal spec.

## Answer

Implemented `/goal` grammar, localized state notices and errors, parameter discovery, Goal root/badge/blocker with local elapsed time, first status chip, and live/replay Goal-source message filtering. The screen re-reads `session.goal` on state changes and Run results so ephemeral activation stays current. Goal root/blocker rows are reserved before allocating collapsible panels; at 40×12 with a Goal and Interaction the context bar yields, while chip/mode, Todo/Subagent previews, input draft and dialog controls remain available. Five-row questions omit the header chip and five-row permission choices truncate to one row. No-Goal presentation remains unchanged.

Verification:

- Public TUI `start()` seam: 12 Goal tests, 84 assertions, 0 failures. Covers grammar, busy restrictions, error localization, phase chip colors, 40-column permission/Plan labels, local elapsed tick/freeze, Goal-preserving folding, all-completed idle Todo, error activation refresh, resume disarmed, hidden internal round input, and active/blocked Goal plus child/question/permission composition at 40×12. Dialog Esc cancellation retains Goal and draft.
- `rtk proxy env -u NO_COLOR bun run check`: exit 0; 1744 pass / 0 fail / 9266 assertions across 136 files. Log: `/tmp/goal-03-check.log`. Includes existing Todo, question, subagent, streaming burst/reading and statusline regressions.
- Initial red tracers reproduced unsupported `/goal`, missing state notice, clipped chip in the short dock, and untranslated Chinese Goal permission warning; each passed after implementation.
- Goal tool cards remain ticket 02 ownership; this ticket does not duplicate their implementation/tests.

Post-integration verification:

- Merged integration tip `9413a2b` (ticket 02) into `codex/goal-03`; removed duplicate bilingual activation dictionary keys from the automatic merge. Added a public live-completion tracer proving Goal state refresh, hidden wrapup input, visible assistant conclusion and disarmed status. Goal screen suite now has 13 tests / 88 assertions.
- `rtk proxy env -u NO_COLOR bun test` over Goal screen, Goal tool cards, Todo/question/subagent composition, streaming burst/reading and statusline files: exit 0; 129 pass / 0 fail / 856 assertions across 7 files. Log: `/tmp/goal-03-postmerge-tests.log`.
- `rtk proxy bunx --no -- tsc -b`: exit 0 after integration. Formatting and `git diff --check` also pass. Root owns the final combined aggregate check and Standards/Spec review.
