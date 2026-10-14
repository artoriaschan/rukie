# 02：既有 System Reminder 改写与自动事件包裹

Status: claimed

Blocked by: 01

**What to build:** 按 [spec](../spec.md#既有-system-reminder-改写工单-02)，改写既有提醒文案，并包裹后台任务与子代理完成通知。

- [ ] 根、子 Session 后台任务通知与子代理完成通知包裹并声明不是用户输入
- [ ] Plan Mode 进入与退出、Goal、Session Move、Deferred Tool、Skill 目录、User Instructions 标签
- [ ] 测试：通知包裹与声明、Frontend 呈现与 `source` 不变；更新文本断言
- [ ] 文档：`packages/agent/README.md` 通知说明

## Comments

- Claimed by fresh implementer implement_02; public Session/model context and Transcript seams follow spec Testing Decisions. Root coordinates aggregate verification.

- Implementation candidate: automatic-event declarations wrap root active/idle jobs, child jobs and every background subagent completion/failure/abort reporter path. `rukie.message-facts` preserves notification body and original `source`; no Frontend wrapper parser added. Native reporter input has no atomic owner-metadata hook: pre-admission presentation facts apply only to one later native input, exclude known human inputs, and are superseded by stable requestId/entryId binding before model requests. Reporter retries reuse native submissions. Exact later human quotes and quotes queued before reporter admission remain human through Resume.
- Reminder copy: Plan Mode effects and ADR-0015 approval/revision/takeover rules, Goal per-requirement evidence audit, stale Session Move path guidance, Deferred Tool loading/capability guidance, task relevance in Skill catalog, distinct User Instructions label. README notification contract updated; ADR-0046/0015 cover existing architecture.
- Verification: 8 public Session red/green slices logged in `/tmp/rukie-reminders-evidence/02-red-N.log` / `02-green-N.log`; initial relevant focused set 188 passed / 0 failed in 12.45s. Identity correction subset 41 passed / 0 failed in 4.41s; human quote/Resume cases 2 passed in 345ms and queued-before-reporter case 1 passed in 237ms. Root active/idle job subset 2 passed in 358ms. Formatting, targeted lint, Agent Core typecheck and documentation checks passed. Detailed record `/tmp/rukie-reminders-evidence/02.md`; root owns aggregate checks and review. Status stays claimed pending integration review.
