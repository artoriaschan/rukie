---
status: accepted
---

# Tool State 保存完整事实快照，模型上下文按当前分支投影

本决定的完整状态消息快照、旧分支投影和进程内续跑开关由新决定部分替代；能力事实所有权、当前上下文与完整 Transcript 的区别继续有效。替代关系见 [ADR-0024](0024-adopt-pi-durable-harness.md)。新决定已接受，实施尚未开始；下文记录迁移前义务，当前进度见[规格与票据](../../.scratch/pi-durable-migration/spec.md)。

## 问题

工具状态需要跨 Run、Resume 和 Compaction 保留，但历史事实、当前模型上下文与进程活动的寿命不同。仅从自然语言结果恢复状态容易遗漏或误判。

## 决定

Transcript 追加按名称与版本校验的完整 Tool State 快照。恢复当前分支时取最后一条有效快照；坏记录告警并跳过，保留之前的有效值。Goal 等可清除状态留下明确的空值快照，不能靠缺少记录推断。Todo、Goal、Plan Mode、模型选择和子代理身份共用这条恢复路径；各能力拥有自己的状态定义。

只持久化恢复后仍有意义的事实。Todo 属于单个 Session，子代理独立维护；当前运行活动、Goal 自动续跑开关与临时会话授权不从历史恢复。活动和 Run Outcome 的区别见 [ADR-0009](0009-subagent-resume-outcomes.md)。

模型上下文由当前分支的消息、Compaction 摘要和有效状态投影构造，`Session.messages` 不等于完整 Transcript。Compaction 保留原始记录，并在摘要与保留尾部之间重新建立当前 reminder 来源；environment 是一次性快照，不重发。后续去重以最近一次压缩后的上下文为边界。状态变化通过能力提供的 reminder 向模型说明，不能指望摘要保存完整状态。

依据：[Todo](../../.scratch/todo/spec.md)、[压缩后的 reminder 重发](../../.scratch/permission-rules/spec.md)、[Goal](../../.scratch/goal/spec.md)。存储选型仍遵循 [ADR-0003](0003-dual-session-store.md)。

## 备选方案

- 从工具结果文本或压缩摘要推断状态：文本并非稳定 schema，压缩还可能丢失当前状态。
- 父子共用 Todo 或每个 Turn 自动清空：破坏 Session 独立性或跨 Run 延续，Todo 规格明确排除这些行为。

## 影响

状态定义需要版本校验与恢复策略；Resume、对话 Rewind、Compaction 必须使用一致投影。完整快照增加记录体积，但减少依赖历史增量顺序和摘要质量的恢复逻辑。Tool View 属于可重建的呈现事实，遵循 [ADR-0008](0008-locale-agnostic-agent-core.md)，不另存一套状态。
