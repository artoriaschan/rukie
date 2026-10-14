---
status: accepted
---

# Session 持久绑定 Project，cwd 跟随主目录，移除 Project 删除其 Session

## 问题

[ADR-0041](0041-desktop-project-explicit-trust.md) 让 server 用“cwd 与 Project 任一目录真实身份相等”现算 Session 归属。切换主目录后旧 Session 留在旧目录；移除某个目录或整个 Project 后，Session 带着项目目录 cwd 落入“对话”，与对话独占 `workspace/<id>` 的不变式（[ADR-0042](0042-conversation-owned-workspace.md)）冲突。用户确认的模型是：Session 属于 Project，不属于某个目录；主目录决定 Session 的工作目录，附加目录扩大访问范围。

## 决定

server 在应用 SQLite 中持久化 `sessionId → projectId` 绑定，它是桌面端 Session 归属的唯一来源。绑定在 `session.create`（选择 Project）与 `session.move` 时写入，在 Session 删除时移除；没有绑定的 Session 属于“对话”。wire Session 摘要的 `projectId` 读取绑定，不再比较 cwd。绑定按 [ADR-0036](0036-shared-development-configuration.md) 属于每个 checkout 的数据根，与 Session 索引同处。Agent Core 不感知绑定，Transcript 不记录它。

Project 主目录切换后，已有 Session 在下次被 server 打开执行时（新 prompt、恢复或其他需要 Session 实例的命令）若 cwd 不等于当前主目录，server 先经 [ADR-0040](0040-session-move-transcript-boundary.md) 的 Session Move 改绑到新主目录再打开；只读订阅历史不触发移动。活跃 Run 不被中断，在其空闲后的下次打开时同步。绑定到独立工作树的 Session 不随主目录同步（[ADR-0045](0045-git-worktree-sessions.md)）。

`project.update` 删减目录或切换主目录不改变任何绑定。`project.remove` 先对每个绑定 Session 执行与 `session.delete` 相同的删除（包括置顶与归档的 Session，并清除其置顶与归档记录），全部成功后再移除 Project 登记；任一 Session 执行中、等待 Interaction 或被其他进程占用时整体拒绝，返回 `session_busy`。中途删除失败时 Project 保留，用户可重试，已删除的 Session 不恢复。Project 目录中的文件永不删除。

本决定替代 ADR-0041 中“目录身份派生展示归属”“`project.remove` 保留 Session”“切换主目录只影响新 Session”的规则；Project 登记结构、显式信任与派生 `trustedProjects` 规则继续有效。打开 Session 时传给 Agent Core 的附加目录为绑定 Project 中除 cwd 以外的目录。

## 备选方案

- 保持 cwd 现算归属：切换主目录与删减目录会让 Session 丢失归属。
- 主目录切换时立即对全部 Session 执行 Session Move：项目内任一 Session 忙碌就必须拒绝切换，保存时间随 Session 数量增长。
- 删减仍有 Session 使用的目录时拒绝保存：在目录归属模型下需要，绑定 Project 后不再需要。
- 移除 Project 时保留 Session 并移入“对话”：Session 的 cwd 仍是项目目录，破坏 ADR-0042 的不变式；用户选择删除。

## 影响

切换主目录后，跨越同步的 Checkpoint 只允许对话 Rewind，模型会被告知目录变化。移除 Project 成为不可逆的 Session 删除，确认文案必须说明。不迁移既有数据：本决定生效前的 Session 没有绑定，显示在“对话”。实施见[工单 02](../../.scratch/session-workspaces/issues/02-session-project-binding.md)。
