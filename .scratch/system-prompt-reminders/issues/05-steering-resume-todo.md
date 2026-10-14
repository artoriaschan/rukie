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
