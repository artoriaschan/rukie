# 09: Compaction

**What to build:** 长时间运行的 Run 不会因为上下文超限而失败。每个 turn 开始前估算一次 token 用量，超过模型上下文窗口约 80% 时，自动调用 pi 的 `compact`。生成的摘要作为一条 entry 写入 Transcript，原始消息保留在文件里；之后的 turn 基于摘要继续，resume 也能正确还原。compaction 发生时发出 `compaction` 事件。

**Blocked by:** 03, 05

**Status:** ready-for-agent

- [ ] 达到阈值时触发 compaction，低于阈值时不触发（阈值可以在测试中通过小的 `contextWindow` 来触发）
- [ ] 摘要写入 Transcript，原始消息仍然保留
- [ ] compaction 之后再 resume，模型收到的上下文是"摘要 + 之后的消息"
- [ ] 发出 `compaction` 事件
- [ ] Seam 1 测试覆盖以上所有行为
