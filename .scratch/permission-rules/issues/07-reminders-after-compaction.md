# 07: compaction 后 reminder 重发

**What to build:** compaction 后，模型立即重新看到 date、user / project instructions、skills、MCP 说明、frontend 传入的 reminder source，以及 Tool State（environment 是一次性快照，不重发）。下一个 run 不重复发送内容未变的 reminder。resume 后恢复的 context 与 compaction 当时一致。reminder 去重统一只对照最近一次 compaction 之后的 transcript，去掉 Tool State source 的特例。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

参考：[spec](../spec.md)「compaction 后 reminder 重发」；User Stories 38–40。

- [ ] 先写一条会失败的 e2e，复现 compaction 后下一次模型请求里缺少 Project Instructions / skills reminder
- [ ] e2e：compaction 后重发上述 source，environment 不重发
- [ ] e2e：compaction 后的下一个 run 不重复发送未变化的 reminder；内容变化的照常发送
- [ ] e2e：resume 后 `session.messages` 与 compaction 当时一致（reminder 块排在 retained tail 之前）
- [ ] 现有 todo-reminders、compaction、reminders 测试保持通过
- [ ] `tsc -b` 与全量 `bun test` 通过
