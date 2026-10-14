---
status: accepted
---

# 对话 Session 独占工作目录，删除时一并删除

## 问题

桌面端“对话”分类的所有 Session 共用 `<dataRoot>/workspace/`。不同对话写入的文件互相可见并可能覆盖；删除对话后其文件无法归属，只能永久留在共享目录中。

## 决定

server 在 `session.create` 选择“对话”时生成独立目录 id，创建 `<dataRoot>/workspace/<id>/` 并以它作为新 Session 的 cwd。目录名不等于 Session id，Agent Core 不感知该目录的来源；Session 与目录的对应关系由 Session 元数据的 cwd 表达。Agent Core 的打开失败（例如模型不可用）时，server 删除刚创建的空目录。

永久删除 Session 时，若其 cwd 的真实路径是 `<dataRoot>/workspace/` 的直接子目录，server 在 Agent Core `deleteSession` 成功后递归删除该目录。删除前校验目标不越出 `workspace/` 根且路径中没有符号链接；Project 目录、工作树目录和 `workspace/` 根本身永远不会被删除。目录删除失败只报告 warning，不回滚已完成的 Session 删除。

对话经 Session Move 移入 Project 后，原 `workspace/<id>/` 保留在原位，与 [ADR-0040](0040-session-move-transcript-boundary.md) 的“文件保留原位”一致；之后删除该 Session 不再处理旧目录。Session 从 Project 移出时，server 创建新的空 `workspace/<id>/` 作为目标 cwd，不复制项目文件。

`workspace/` 继续位于应用数据根内，[ADR-0041](0041-desktop-project-explicit-trust.md) 的保留规则使它及其子目录不能登记为 Project。本决定替代 ADR-0041 与 [CONTEXT](../../CONTEXT.md) 中“对话共用 `workspace/`”的表述。不迁移 cwd 为 `workspace/` 根的既有 Session。

## 备选方案

- 目录名等于 Session id：需要 Agent Core 新增“以指定 id 新建”的入口，改变 store 的 id 所有权，换来的只是 Finder 中可读的目录名。
- 目录放在 `<dataRoot>/<id>/` 或新根 `conversations/`：要修改 sidecar 显示与终端的允许根，`workspace/` 已有保留与允许规则。
- 删除 Session 时保留目录：每个对话都留下孤儿目录，`workspace/` 无限增长。
- 移入 Project 时删除旧目录：与 ADR-0040 冲突，并让 Transcript 中的旧路径失效。

## 影响

删除对话会永久删除该对话目录中的全部文件，删除确认文案必须说明。移入 Project 的对话会留下旧目录，需要用户自行清理。实施见[工单 01](../../.scratch/session-workspaces/issues/01-conversation-workspaces.md)。
