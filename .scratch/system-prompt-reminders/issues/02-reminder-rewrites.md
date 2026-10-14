# 02：既有 System Reminder 改写与自动事件包裹

Status: resolved

Blocked by: 01

**What to build:** 按 [spec](../spec.md#既有-system-reminder-改写工单-02)，改写既有提醒文案，并包裹后台任务与子代理完成通知。

- [x] 根、子 Session 后台任务通知与子代理完成通知包裹并声明不是用户输入
- [x] Plan Mode 进入与退出、Goal、Session Move、Deferred Tool、Skill 目录、User Instructions 标签
- [x] 测试：通知包裹与声明、Frontend 呈现与 `source` 不变；更新文本断言
- [x] 文档：`packages/agent/README.md` 通知说明

## Comments

- Claimed by fresh implementer implement_02; public Session/model context and Transcript seams follow spec Testing Decisions. Root coordinates aggregate verification.

- Implementation candidate: automatic-event declarations wrap root active/idle jobs, child jobs and every background subagent completion/failure/abort reporter path. `rukie.message-facts` preserves notification body and original `source`; no Frontend wrapper parser added. Native reporter input has no atomic owner-metadata hook: pre-admission presentation facts apply only to one later native input, exclude known human inputs, and are superseded by stable requestId/entryId binding before model requests. Reporter retries reuse native submissions. Exact later human quotes and quotes queued before reporter admission remain human through Resume.
- Reminder copy: Plan Mode effects and ADR-0015 approval/revision/takeover rules, Goal per-requirement evidence audit, stale Session Move path guidance, Deferred Tool loading/capability guidance, task relevance in Skill catalog, distinct User Instructions label. README notification contract updated; ADR-0046/0015 cover existing architecture.
- Verification: 8 public Session red/green slices logged in `/tmp/rukie-reminders-evidence/02-red-N.log` / `02-green-N.log`; initial relevant focused set 188 passed / 0 failed in 12.45s. Identity correction subset 41 passed / 0 failed in 4.41s; human quote/Resume cases 2 passed in 345ms and queued-before-reporter case 1 passed in 237ms. Root active/idle job subset 2 passed in 358ms. Formatting, targeted lint, Agent Core typecheck and documentation checks passed. Detailed record `/tmp/rukie-reminders-evidence/02.md`; root owns aggregate checks and review. Status stays claimed pending integration review.

- Integration: merged 79fefeee (03+04), retaining time and correction reminder projection. Composition checks: 53 cases with 51 passed and 2 stale provider-timestamp fixture assertions failed; root-approved Session-clock injection preserves collision coverage, only those 2 rerun and passed (369ms). Active/idle jobs 2 passed (332ms); Agent Core typecheck and affected lint/format/diff checks pass. Original failed run remains recorded in detailed evidence. Native request identity supersedes temporary correlation, and reporter retries skip duplicate pre-facts. Awaiting root review and aggregate acceptance.

- Final acceptance repair: job-notifications active/idle/cancelled-wait cases assert the exact model wrapper and automatic-event declaration while also asserting unchanged Transcript source=job and display body. Goal reporter scripted responses recognize the declared Subagent event, retaining exact final answer, aggregate usage and Goal phase checks. All five cases failed before test-consumer correction; related files pass. Minimum reproduction: 8 fail / 0 pass, 704ms; corrected minimum: 8 pass / 0 fail, 659ms. Expanded affected files plus direct context/admission consumers: 62 pass / 0 fail, 359 assertions, 3.83s; no case over 1s. Agent types and affected lint pass. Original aggregate remains failed (8 failures), later stages unrun; root coordinates remaining acceptance. Full commands/logs: `/tmp/rukie-reminders-evidence/acceptance-fixes.md`. Status remains claimed.

- Frontend acceptance repair: Frontend acceptance repair preserves native notification content union: root job remains text array/source=job; Subagent report remains raw string/no source, while model receives exact wrapper. Public human-quote/Resume regression red then green; unchanged bytes/source/replay assertions retained. Related6files117pass/0fail7.92s; additional clock consumers6pass/0fail807ms; strengthened2assertions2pass/0fail844ms. Original1539pass/5fail213.05s remains recorded, not relabelled. All modified cases under1s; targeted types/lint passed. Full commands/failures/evidence: `/tmp/rukie-reminders-evidence/frontend-fixes.md`. Status remains claimed pending root delivery.

### Final delivery verification (2026-10-15)

实现、受影响消费者、文档、评审修复及适用本地验证已完成。工单由独立新 implementer 在独立工作树实施，当前实现代码为 `3652bd51`；本工单的 focused 与增量证据见上方记录，原始失败事实保留。

统一验收结果、ADR Coverage 审阅和证据复用范围由 [spec 交付记录](../spec.md#delivery-and-adr-coverage-review-2026-10-15) 唯一维护。PR [#27](https://github.com/artoriaschan/rukie/pull/27) 在 `feat/system-prompt-reminders` 交付，最新 CI 待验收，尚未合并；`resolved` 不表示 CI 或合并完成。
