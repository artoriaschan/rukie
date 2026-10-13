---
status: accepted
---

# Session Move 改绑 cwd 并以 Transcript 记录移动边界

## 问题

用户需要把已有 Session 移到正确的 Project，保留身份、标题与对话。原来的固定工作目录定义无法表达该操作；直接修改索引既不能告知模型，也不能安全约束旧目录的文件恢复。

## 决定

Session 只有一个当前 cwd，SQLite Session 可通过 Session Move 改绑。Agent Core store 的公开移动接口取得与执行相同的写者租约，验证 Session 身份及旧 cwd，在一个原生事务中追加旧、新 cwd 的 Transcript 记录并更新会话元数据，然后释放租约。它不创建 Session、不调度 Session Resume、不解析模型或凭据。文件保留原位。JSONL 按 cwd 分目录，明确拒绝移动。

下一次 Run 读取最近且尚未告知的移动事实，把工作目录变更的 system reminder、新 cwd 的环境快照和告知进度在同一事务提交。多个未告知的移动只告知最近一次；恢复已提交事实不重复注入。Session scope document 保存最近移动 entry 及告知进度，属于 Transcript 移动记录的运行投影，不属于桌面索引。Conversation Rewind 不撤销 cwd 或移动边界。若回退后旧环境快照再次进入当前对话，下一次 Run 补发当前 cwd 的快照，告知进度不回退且移动 reminder 不重复。

目标 prompt 的 entry 早于最近 Session Move 时，Agent Core 拒绝代码恢复，保留只回退对话的能力。TUI 从公开 Checkpoint 的禁止原因禁用代码恢复选项。移动不授予目录信任；目标 Project 的登记和信任由 Frontend 与 server 在调用前决定。

本决定修订 [CONTEXT](../../CONTEXT.md) 的固定工作目录定义，并部分替代 [ADR-0017](0017-checkpoint-and-branch-rewind.md) 与 [ADR-0024](0024-adopt-pi-durable-harness.md) 的代码 Rewind 可用范围；原生 fork、恢复、任务所有权和备份规则继续有效。存储位置及单写者租约沿用 [ADR-0035](0035-desktop-isolated-sqlite-storage.md)。附加目录与 cwd 的区别由 [ADR-0039](0039-session-additional-directories.md) 记录。

## 备选方案

- 复制 Session 到新 Project：不满足保留 id 与原地改绑的要求。
- 移动时打开并恢复 Session：会调度未完成工作或读取模型、凭据，不符合组织操作的边界。
- 同时搬迁工作目录文件：超出移动 Session 的范围，会改变用户文件。

## 影响

移动对 Transcript 和 cwd 原子生效，但保留原目录的文件历史。跨移动的代码恢复被禁止，以免重写旧目录文件；对话回退仍保留原生历史分支。调用方应先关闭闲置的 Session，再在新 cwd 打开；忙碌、缺失或旧 cwd 不符时明确拒绝。运行合同见 [Agent README](../../packages/agent/README.md)，实施范围见 [规格](../../.scratch/project-directories/spec.md) 与 [工单](../../.scratch/project-directories/issues/02-session-move-core.md)。
