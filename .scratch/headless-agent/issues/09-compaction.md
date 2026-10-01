# 09: Compaction

**What to build:** 长时间运行的 Run 不会因为上下文超限而失败。每个 turn 开始前估算一次 token 用量，超过模型上下文窗口约 80% 时，自动调用 pi 的 `compact`。生成的摘要作为一条 entry 写入 Transcript，原始消息保留在文件里；之后的 turn 基于摘要继续，resume 也能正确还原。compaction 发生时发出 `compaction` 事件。

**Blocked by:** 03, 05

**Status:** resolved

- [x] 达到阈值时触发 compaction，低于阈值时不触发（阈值可以在测试中通过小的 `contextWindow` 来触发）
- [x] 摘要写入 Transcript，原始消息仍然保留
- [x] compaction 之后再 resume，模型收到的上下文是"摘要 + 之后的消息"
- [x] 发出 `compaction` 事件
- [x] Seam 1 测试覆盖以上所有行为

## Comments

- 2026-10-01：每个模型请求前通过 pi 的 `estimateTokens` 估算当前上下文（含 System Prompt、工具声明和转换后的 reminder）；超过 `contextWindow` 的 80% 时调用 pi 的 `prepareCompaction` / `compact`，摘要请求复用同一个 provider 边界并接收 Run 的取消信号。
- compaction entry 和 `main` 分支 tip 在同一个原生存储事务中追加，之后才发出 `compaction` 事件；原始消息不修改。当前 Session 和 resume 都保留 System Prompt 基线，并从最新摘要、retainedTail 和之后的消息恢复模型上下文；reminder 增量比较仍使用完整 Transcript。
- 当前待处理的 user prompt 和尾随 Skill Invocation 保持原样。处理超大近期消息、同一 Run 内反复压缩，以及 pi split-turn 无旧消息时遗漏上一摘要的边界；扩展压缩范围后重新收集原生文件操作元数据。通过 pi 的 system 状态重放保留有效工具声明，避免压缩丢失 MCP 工具的增删信息。
- Seam 1 增加 10 个测试：阈值、JSONL 原始前缀保留和事件落盘顺序、resume 精确恢复、超大工具结果、可替换 Memory Session Store、多次同一 Run 压缩、Skill Invocation、MCP 工具声明更新、摘要失败和取消后的恢复。
- 验证：`bun run check` 通过（格式、lint、`tsc -b`、knip、全量 128 个测试）；规范审查和规格审查各 0 项剩余问题。
