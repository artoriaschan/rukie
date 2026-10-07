# 07: 特殊交互与辅助消息

Status: resolved
Blocked by: 01

**What to build:** 用户在会话中清晰阅读问题回答、计划评审、Todo 和辅助提示，特殊工具不重复显示，正文与交互面板保持正确顺序和焦点。

规范用户故事：37–40、54–55、60–61。

以 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 和父规范为准。保留 Neant 品牌、中英 Locale、Session 权限与生命周期；缺失信息不伪造，不新增老会话兼容。必要数据、消费者、公开行为测试和所属文档在本工单一起交付，使用现有 start/startWithClock 与必要的 createSession 入口。开发运行最小受影响检查，代码交付遵循仓库完整验证规则。

## Acceptance criteria

- [x] 问题回答、计划评审和 Todo 呈现对齐参考或规范确认的 Neant 适配，特殊调用不同时重复显示普通工具卡。
- [x] 用户回答、拒绝、取消、计划批准／修订／接管和 Todo 变化都由真实 Interaction 或 Tool State 事实驱动，保留安全默认值。
- [x] notice、compaction、可获得的用量摘要、错误和中断有正确层级、标记、颜色与消息顺序，不制造不存在的 local shell 等执行模式。
- [x] 计划及其他 Markdown 内容复用 01 的呈现，展开入口、滚动、正文选择与卡片动作边界清楚。
- [x] 错误／中断提示保留已持久化部分输出；本工单的实时和新会话恢复呈现一致，不重复提示，不伪造工具成败。
- [x] 问题、审批及其他现有面板共存时按键、滚轮与焦点归属正确，缺失回调和 Run 中断行为不改变。
- [x] 通过现有 start/startWithClock 和必要的 createSession 入口覆盖特殊路由、各种交互结果、恢复和中英文，不验证私有投影代替外部行为。
- [x] 小终端、resize 和阅读位置保持既有规则，必要新增持久化事实在本工单实现，不将恢复能力全部推迟到 11。

## Implementation evidence

- Claim: `codex/streaming-parity-07`, `/tmp/neant-streaming-parity-07`, integration baseline `d836e97`.
- Existing dedicated question summaries, plan review/card and Todo panel remain the single routes; real Interaction/Tool State tests cover answer/refusal/cancellation, approve/revise/takeover, safe missing callbacks, focus, wheel, resizing and small terminals. Markdown uses the shared 01 component. Usage rows remain disabled as in the fixed reference; no invented shell mode or usage facts.
- Fixed reference `3c89ea516e4f7d2777efe979200016528722a0b4`: `MessageList.tsx` auxiliary notice uses quiet Divider with marginTop=1; interruption uses two dim lines. Neant localizes these lines and keeps native assistant error marker/red color, persisted partial body/thinking and real native compaction facts.
- Agent Core persists locale-agnostic, model-invisible `session-notice` facts for Hook messages/warnings and unreconstructable Run endings. Persisted decoding validates unknown input. Native abnormal assistant messages supply the outcome directly; an actual Run interruption after a native error explicitly correlates that error by its actual assistant timestamp. General Hook cards restore once in order; SessionEnd diagnostics and MCP connection state remain ephemeral lifecycle observations.
- Message save failure restores durable branch messages. Existing Unknown Tool Outcome repair reconciles saved calls without saved results, without replay or inferred success/failure. Public `conversation_reconciled` tells Frontends to read `Session.messages`; TUI replaces optimistic cards. Actual-write failure test proves side effects remain, previous Turn remains, live/Resume agree, and the next model context contains unknown outcome but no auxiliary facts. Recovery-write failure retains the restored branch and surfaces the actual persistence error.
- Public new regressions: `auxiliary-messages.test.ts` (virtual clock, en/zh partial error/abort, rejected assistant/ToolResult save, native compaction, real Hook commands/resume); `session-notices.test.ts` (actual pending question cancellation and blocked Hook prompt/resume/model invisibility). Todo tests synchronize on visible smooth reveal completion instead of idle alone.
- Verification: 114 question/plan/Todo/Interaction tests passed (12.43s), 105 auxiliary/Hook/unknown-outcome tests passed (5.52s), focused save failures 2 passed (0.657s). No new test exceeds one second; command Hook process completion is synchronized by real events. `bun run check:dev` passes. Aggregate check is owned by the integration task after all tickets merge.

- Integration verification: merged current integration `5d5a28a` via `3850020`; only conflict was the same Todo reveal-completion predicate, retaining the integration platform-independent variant. Post-merge `bun run check:dev` passes; auxiliary/Todo/unknown-outcome/core notice 21 tests pass (3.55s, 152 assertions). Implementation commit `2ef4e2a`.
