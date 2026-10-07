# 06: Subagent 卡与只读详情

Status: resolved
Blocked by: 03

**What to build:** 用户能观察 Subagent 的真实当前活动，进入工具详情或主屏只读视图，并清楚区分运行结束、错误和委派任务判断。

规范用户故事：33–36、44、48、55–57、60–61。

以 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 和父规范为准。保留 Neant 品牌、中英 Locale、Session 权限与生命周期；缺失信息不伪造，不新增老会话兼容。必要数据、消费者、公开行为测试和所属文档在本工单一起交付，使用现有 start/startWithClock 与必要的 createSession 入口。开发运行最小受影响检查，代码交付遵循仓库完整验证规则。

## Acceptance criteria

- [x] 运行卡展示描述、模型、真实耗时／token 等可获得信息、当前工具及固定三行输出，标题与状态颜色对齐参考。
- [x] 正常结束收起，失败保留错误；中断、idle 与未知 Run Outcome 保持可区分，不从无活动推断任务已完成。
- [x] 卡片点击打开详情，独立入口打开主屏只读 Agent View；用户不会通过只读视图误提交输入，返回父会话恢复正确焦点。
- [x] 详情中的工具调用复用 03 的结构化呈现和独立动作入口；子代理正文、思考和工具顺序来自真实事件。
- [x] 多个 Subagent、续跑与工具交错时各自输出和当前活动关联正确；输出 waterfall、阅读位置及 resize 不回归。
- [x] 新会话恢复重建已有子 Session 信息与 Run Outcome，未知保持未知，不自动续跑；必要历史事实由本工单补齐并验证。
- [x] 复用实际 createSession 与 TUI start 入口验证运行、结束、失败、详情、只读视图和恢复，保持既有子代理权限与消息语义。
- [x] 中英文、小终端、面板焦点和终端恢复有公共行为覆盖；不把 Subagent 合并为 Background Job。

## Implementation and verification

- `Session.readSubagent` is an ownership-checked read-only snapshot capability, using live child facts or the existing `find/openReadonly` store boundary. It does not create, repair or run a child. Model, actual Run duration and usage are optional durable facts; restored Activity remains idle and the actual/unknown Run Outcome supplies its separate ending label.
- Cards keep the fixed three hard-clipped output rows and current tool, use actual success/error status, retain failure reasons, and expose glyph-only detail and independent `⤢` Agent View targets. Missing historical metrics stay absent. Normal Run ending is labelled as a Run ending, not delegation completion.
- Agent View projects real user/assistant blocks and matching results in order, reuses ToolCall structured actions/windows, captures input/paste without submission or interruption, preserves drafts/parent scroll, and allows manual reading without new output forcing bottom. Cold history is loaded only when requested; continuations retain their own active association.
- Public RED evidence: absent `readSubagent` failed the actual createSession live/resume observation test; running cards initially fabricated `0 tok`; committed tool-use message omitting streamed text left ghost waterfall rows; ToolWindow keyboard ownership was bypassed by the detail view. Each has focused public GREEN coverage.
- Synced integration `994fbaa` (04/07) and `d2f07f8` (settled thinking lifecycle); preserved renderer text-selection handled fences, SessionNotice reconciliation, and scoped ToolWindow ownership. No full gate run here; root owns the final integration gate.
- `env -u NO_COLOR bun test` for subagent-card, subagent-views, subagent-parity, subagent-observation and subagent-reconciliation: **37 passed, 202 assertions, 6.28 s**. Actual createSession covers durable metrics/saved message order/readonly resume; virtual-clock public TUI cases cover live/failed/normal/abort, eight children, continuation, zh/en, small resize, draft/focus/read anchors, structured tools and Agent View pointer/PageDown/Esc window ownership. Slowest case was the real Bash process window wiring case at 739 ms; no fixed sleeps.
- `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/thinking.test.ts`: **8 passed** after syncing the historical-thinking fix. `bun run check:dev` and integration diff whitespace check passed.

## Integration fix: child history uses native Run sequence

- Root/public read-only audit on integration `7709774` reproduced two timestamp boundary errors: future provider timestamps omit earlier saved child text; past/colliding timestamps duplicate the current committed thinking and Tool Turn when history is prepended to already observed events. External red: `/tmp/neant-streaming-audit/recovery.test.ts`, 2 failures / 17 assertions / 610ms. Preparation matrix: `/tmp/neant-streaming-recovery-notes.md`; ticket 11 remains unclaimed pending 10.
- `Session.readSubagent` now projects live/cold snapshots through one native branch path and supplies `historyMessages` before the actual latest Run's first `tool-state/subagent-run` start entry. Active reads use the child's serialized store lease; idle observations use `openReadonly`, never native repair or Run creation. The screen prepends only this prefix to current observed events. No new attempt, migration, synthetic timing or compatibility facts.
- A separate public saved-child red confirms native Unknown Tool Outcome (`isError=false`) was mislabelled completed by `projectSubagent`. Shared `isUnknownToolOutcome` now selects unknown status; child detail shows `?` and localized uncertainty disclosure, with no guessed success/failure or replay.
- Repo public tests `subagent-history-boundary.test.ts`: future/past provider clocks, actual continuation, previous/current output once, current read Tool once, save/Resume snapshot prefix and exact native timestamps; read-only unknown write card and no side-effect execution/model request. Owning README documents committed snapshots and native sequence boundary.
- Worktree `/tmp/neant-streaming-subagent-history`, branch `codex/streaming-parity-subagent-history`, baseline `7709774`. Focused new tests 3 pass / 34 assertions / 665ms; broader pre-final set 26 pass / 190 assertions / 6.08s. All new cases below one second; virtual clock and public terminal/completion signals, no fixed sleeps. Static/final focused evidence appended after final checks; aggregate gate remains integration-owned.

- Final focused/static verification: 27 tests / 197 assertions / 6.04s across child history, observation, card, detail and recovery suites; `bun run check:dev` passes after readonly lease and unknown-result disclosure changes.
