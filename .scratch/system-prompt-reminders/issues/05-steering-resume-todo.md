# 05：插入消息、中断恢复与 Todo 提醒

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#插入消息中断恢复与-todo工单-05)，为运行中插入的消息、存在 Unknown Tool Outcome 的续跑和久未更新的 Todo 提供提醒。

- [ ] steer 与 Queued Input 放入时的说明，区分是否打断当前输出
- [ ] Resume 续跑且存在 Unknown Tool Outcome 时的恢复提醒
- [ ] Todo 8 Turn 未更新提醒、间隔 8 Turn，上下文看不到清单时立即重新提供
- [ ] 测试：插入消息两种情形、续跑提醒、Todo 阈值与间隔、Compaction 后重新提供

## Comments
