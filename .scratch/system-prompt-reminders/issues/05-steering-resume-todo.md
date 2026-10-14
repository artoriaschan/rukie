# 05：插入消息、中断恢复与 Todo 提醒

Status: claimed

Blocked by: 01

**What to build:** 按 [spec](../spec.md#插入消息中断恢复与-todo工单-05)，为运行中插入的消息、存在 Unknown Tool Outcome 的续跑和久未更新的 Todo 提供提醒。

- [ ] steer 与 Queued Input 放入时的说明，区分是否打断当前输出
- [ ] Resume 续跑且存在 Unknown Tool Outcome 时的恢复提醒
- [ ] Todo 8 Turn 未更新提醒、间隔 8 Turn，上下文看不到清单时立即重新提供
- [ ] 测试：插入消息两种情形、续跑提醒、Todo 阈值与间隔、Compaction 后重新提供

## Comments

- Claimed by fresh implementer 05 on feat/reminders-05, based on integration 952b9fe8. Public createSession/model context/Transcript seams pre-agreed in spec; using TDD. Verification owner: root; focused evidence /tmp/rukie-reminders-evidence/05.md.

- Implemented arrival facts after actual native placement (withdrawal has no notice; admission does not itself interrupt), exact-receipt accepted-Run Resume recovery guidance, and durable Todo 8-Turn update age / 8-Turn cooldown with actual-context re-publication for root and child Conversations. Owner documentation updated; ADR-0046 covers the contract.
- Focused verification: 24 tests passed / 0 failed, 159 assertions, 2.28s across Todo, queued inputs, native tool replay and arrival formatter. Narrow agent types/lint, documentation checker, task formatting and diff checks passed. Initial red, Compaction regression/fix, environment/type errors and unsupported experimental abort-queue fixture are retained in external evidence `/tmp/rukie-reminders-evidence/05.md`; no aggregate run or push by implementer. Status remains claimed pending final review and root verification.

- Integrated latest01-04 tip `e9d570fc`, preserving correctionLimit/accepted-input hooks and notification displayContent/modelContent/requestId plus output-length reminderContent. Combined affected Session/formatter/correction checks:31 passed/0 failed,175 assertions,2.78s; narrow agent type/lint, formatting and diff checks passed. Source composition evidence is `/tmp/rukie-reminders-evidence/05-merge-focused.log`; prior unaffected notification/time evidence reused.

- Review repair: actual child input placement now publishes a parent-worded arrival notice for active send_message and parallel retained delegation; explicit no-human-authorization wording and existing no-interruption/withdrawal semantics preserved. Public active child behavioral red then green; active plus cold-child race2pass/0fail,378ms; existing queued-input/human quote cleanup cases pass. Reporter admission race uses shared idempotent runner-owned onTestFinished/finally cleanup. Types/lint/docs passed; root owns aggregate. Evidence: `/tmp/rukie-reminders-evidence/review-fixes.md`. Status remains claimed.

- Incremental replay repair: persisted duplicate pre-admission parent arrival facts resolve to one native placement and now emit exactly one reminder, including already-persisted replay state. Public createSession/real child/send_message model-context red reproduced two notices; green normal and replay cases 2pass/0fail,357ms. Child steering/parallel plus human queued placement and interrupted receipt cases 9pass/0fail,66 assertions,568ms; agent types and focused lint/format pass. External verification and original red logs: `/tmp/rukie-reminders-evidence/replay-fix.md`. No production admission/withdrawal or wording change; root owns aggregate and closure.
