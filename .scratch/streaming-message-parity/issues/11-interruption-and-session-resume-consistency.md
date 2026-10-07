# 11: 中断、错误与新会话恢复一致性

Status: resolved
Blocked by: 02, 04, 05, 06, 07, 09, 10

**What to build:** 用户中断、遇到 provider 错误或恢复新会话后，看到与真实保存内容一致的完整消息事实，界面临时状态重置，后台活动不会因查看历史重新执行。

规范用户故事：13、20、36、39–41、55–57、61。

以 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 和父规范为准。保留 Neant 品牌、中英 Locale、Session 权限与生命周期；缺失信息不伪造，不新增老会话兼容。必要数据、消费者、公开行为测试和所属文档在本工单一起交付，使用现有 start/startWithClock 与必要的 createSession 入口。开发运行最小受影响检查，代码交付遵循仓库完整验证规则。

## Acceptance criteria

- [x] 混合正文、思考、工具、特殊交互和 Subagent 的新会话，保存后恢复保持消息顺序、最终内容、状态和必要历史元数据；前置工单已各自验证所属恢复路径，本工单验证跨类型一致性。
- [x] 保留已经写入 Transcript 的 aborted/error 部分正文和思考，显示明确原因；不新增 attempt 模型，不按 stopReason 错误删除持久化内容。
- [x] 未提交临时显示依据最终保存结果收束，正常结束、用户中断及 provider 错误都不产生重启消失的界面尾部或重复消息。
- [x] 工具结果未知明确呈现，完整源或真实历史字段缺失按事实披露，不伪造成功、失败、耗时、token 或进度。
- [x] 恢复的展开、选区、悬停、消息选择和滚动采用默认界面状态；界面临时状态和 Tool View 不作为持久化事实保存。
- [x] Background Job 恢复为空，不将历史工具关联到新任务；Subagent 不自动续跑，未知结果不自动重放，既有权限、资源和 Run 完成条件不改变。
- [x] 必要保存契约在所属模块保持单一表达并同步公开文档及消费者；不保留老会话兼容、回填或迁移路径。
- [x] 通过 createSession 与 fake model 检查真实保存后恢复，并用 start 验证最终 UI；用隔离 homeDir 和公开完成信号覆盖中断、错误及切换，保留原始保存事实可核对。

## Implementation and verification evidence

- Claimed after all dependencies resolved on verified integration `c3102e2`; worktree `/tmp/neant-streaming-parity-11`, branch `codex/streaming-parity-11`. This ticket closes cross-type consistency with public regression coverage; the owning execution and persistence changes are already integrated from 02/06/07. No new production contract, attempt model, migration or compatibility path was needed.
- New `mixed-session-resume.test.ts` creates real Sessions in isolated project/home directories with explicit fake model replies. One Run saves thinking, Markdown, an actual read, an answered question, Todo and a completed child. An English provider error and a Chinese user abort then commit partial thinking/body. Public `createSession` Resume checks actual native content/stopReason, ToolResult order, Todo, child input/output/outcome and empty jobs; fresh `start` checks mixed message order once, one ending, default folds, no restored selection paint or clipboard effect, and read-only Agent View with no model request.
- A separate actual write ToolResult append failure preserves the earlier mixed prefix and executed file side effect. Public Resume validates the shared Unknown Tool Outcome fact; live/cold presentation stays unknown with one tool disclosure and one native ending. Viewing never retries the write or child. The next explicitly submitted prompt retains the unknown outcome in model context and strips session notices. The recovery reason also appears as the unknown tool's explanatory text; that is not a duplicate outcome card.
- A long mixed history scenario first pauses reading and selects a message, then opens a fresh Resume. It starts at the saved tail with default paint and input ownership, no unread notice or detail view. Typing edits the fresh draft without starting a model call. Expanded thinking/tool state and a held painted selection and active card hover are independently reset in the normal/abnormal mixed cases.
- These new assertions were green against the integrated fixes after correcting test synchronization to wait for cold child output loading. No new public production red was found; previously confirmed partial-save, thinking and child ordering reds remain in their owning tickets/tests. The optional same-ms snapshot-owner hypothesis was not used to justify speculative API changes.
- Reused focused public coverage: `auxiliary-messages.test.ts` for committed error/abort, failed assistant save removing ghost thinking/body, ToolResult reconciliation, Hook notices and compaction; `resume.test.ts` for saved suffix ordering; `recovery-history.test.ts` and `subagent-history-boundary.test.ts` for completed/interrupted child histories, native sequence boundary and unknown child tool result; Core `session-recovery.test.ts`, `session-notices.test.ts` and `subagent-observation.test.ts` for actual child persistence/completion and read-only snapshots.
- Complete tool source/unknown historical facts use the existing `tool-windows.test.ts` retained-source Resume cases, including last-window/full-output-unavailable disclosure and no replay. `background-jobs.test.ts` checks a historical actual job is not linked to a new same-command job. TUI `session-recovery.test.ts` covers abnormal child recovery in zh/en at 40×12 and 80×24, uncertainty without activity and actual process shutdown persistence. No tool, job or child Run is automatically started by historical viewing.
- New cases: 4 passed / 174 assertions / 1.53s (slowest 375ms), virtual clock for all same-process timers, public Run/terminal completion signals, no fixed sleeps. Combined focused actual-session/TUI recovery set: 47 passed / 533 assertions / 14.65s. Additional thinking, retained-tool-source and TUI child recovery set: 22 passed / 156 assertions / 5.54s. Existing background-process timing cases account for the slower focused set (2.14s, 3.27s, 2.42s); this ticket adds no process timers or real waits.
- Owning TUI README now states mixed interrupted/recovered history, temporary interface defaults and failed-save uncertainty. Final static/diff and integration synchronization evidence follows. The full aggregate gate remains owned by final integration; ticket 12 is still separate acceptance work.

- Final `bun run check:dev` and `git diff --check` passed. Synced current integration `c3102e2`; the independent 07/10 Interaction-over-Agent-View fix does not change these recovery fixtures. No full aggregate gate was run in this worktree.
