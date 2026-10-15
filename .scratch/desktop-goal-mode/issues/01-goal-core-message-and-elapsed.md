# 01：Goal 目标消息、附件与已执行时间

Status: ready-for-agent

**What to build:** 按 [spec](../spec.md) 的「Agent Core」与「TUI 与 headless」两节，让 `createGoal` 把目标写成可见的人类用户消息（可带图片、可只发图片），并在 Goal Tool State 中持久化已执行时间。

- [ ] `createGoal(objective, { images?, maxRounds? })`：在同一个请求中写入人类来源的目标消息（文本加图片），作为第 1 轮输入并计入 `roundsStarted`；第 2 轮起使用 `<goal_round>`；图片沿用 `validateImage`
- [ ] 文本与图片至少一项；`objective` 允许为空
- [ ] Goal Tool State 升级到 version 2：`attachments`、`elapsedMs`、`activeSince?`，`parse` 校验 `activeSince` 只在 armed 时存在
- [ ] 已执行时间的结算点：暂停、受阻、停止、出错、完成、清除、轮次用尽、每轮结束；恢复时如果推进没有继续，丢弃未结算的段；Fork 清空 `activeSince`；Rewind 恢复当时的值
- [ ] `objective` 为空时，`<goal_round>` 与 reminder 改为引用目标消息中的附件并给出数量；按 ADR-0046 更新模型指引
- [ ] 非完全访问时，`warn` 文案改为建议完全访问
- [ ] TUI `/goal` 与 headless `--goal` 的对话展示目标用户消息；更新它们的测试断言
- [ ] 更新 CONTEXT.md 中的 Goal 条目、ADR-0018（见 spec 的 ADR Coverage）、`packages/agent/README.md#goal-continuation`
- [ ] 测试：带图片、只发图片、文本和图片都为空时拒绝；虚拟时钟验证时长的各个结算点；恢复、Fork、Rewind；权限提示文案；`bun run test:agent` 与受影响的 coding-agent 测试

## Comments
