---
status: accepted
---

# Checkpoint 归真实用户输入，Rewind 保留对话分支

本决定的 main branch tip 与旧恢复引擎约定由新决定部分替代；真实用户输入锚点、文件备份范围和保留原历史继续有效。替代关系见 [ADR-0024](0024-adopt-pi-durable-harness.md)。下文保留旧存储实现的历史决定；当前原生 fork 与文件恢复契约由 [Agent README](../../packages/agent/README.md#checkpoint-and-rewind)维护，实施边界见[规格与票据](../../.scratch/pi-durable-migration/spec.md)。

## 问题

用户需要同时或分别撤回代码与对话；子代理和内部续跑也会修改文件。使用项目 Git 无法可靠覆盖未跟踪文件，还会影响用户已有工作区状态。

## 决定

每条真实用户 prompt 建立一个 Checkpoint 锚点。文件工具 write、edit 获得授权后、首次修改最终 realpath 目标前，记录原样字节或文件不存在这一事实；备份按内容 hash 存入 Session 的文件历史。内部 Goal、hook 续跑与子代理通知沿用当前锚点。子代理共用父 Session 的记录器，记录写入父 Transcript。

Checkpoint 的范围只包括 write、edit，不追踪 bash、MCP 或任意外部副作用。Rewind 在父子均空闲时执行，可恢复代码、对话或两者。代码恢复先检查所需备份，再覆盖目标锚点之后的文件修改；它不提供冲突合并。两者都恢复时先恢复代码，失败则不移动对话。

对话恢复保留原分支，将 main 移到目标 prompt 之前，重建模型上下文、Compaction 与 Tool State。历史子代理记录不因此重新运行，Goal 自动续跑也不会重新开启。

依据：[Checkpoint 规格](../../.scratch/checkpoint/spec.md)。文件变更基线与代码、对话单独恢复的协作见 [ADR-0020](0020-file-tracking-baseline-transactions.md)。

## 备选方案

- 借用项目 Git 管理备份：不能直接覆盖非 Git 项目及未跟踪文件，也会耦合用户的分支与工作区操作。
- 给每次内部续跑或子代理单独建立锚点：同一用户请求的修改被拆散，父代理的撤回不能覆盖委派结果。

## 影响

文件历史由 Session 管理，需要独立清理。用户应理解代码恢复会覆盖后续修改，且不撤销工具范围之外的副作用；对话分支保留历史事实，但不等于外部世界回滚。细节与限制由 [CONTEXT](../../CONTEXT.md) 和 [Agent README](../../packages/agent/README.md)维护。
