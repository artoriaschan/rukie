# 01：对话独立工作目录

Status: ready-for-agent

**What to build:** 按 [spec](../spec.md#对话目录工单-01) 与 [ADR-0042](../../../docs/adr/0042-conversation-owned-workspace.md)，让每个新对话拥有并在删除时清理 `<dataRoot>/workspace/<id>/`。

- [ ] `session.create { project: null }` 创建 `workspace/<id>/` 并作为 cwd；Agent Core 打开失败时删除该空目录
- [ ] `session.delete` 在 Core 删除成功后删除 cwd 为 `workspace/` 直接子目录的目录；越界、符号链接与 `workspace/` 根不删除；目录删除失败只 warning
- [ ] 删除确认框对 `projectId === null` 的会话增加目录删除说明，zh 与 en 同步
- [ ] 测试：server wire 覆盖两个对话 cwd 不同且在 `workspace/` 下、open 失败不残留、删除清理目录、项目会话删除不碰项目目录、`workspace/` 根 cwd 不删除、符号链接拒绝；更新断言固定 `workspace` 根 cwd 的既有用例；UI browser 覆盖两种删除文案
- [ ] 文档：CONTEXT.md Project 词条、server README、desktop README 中“共用 `workspace/`”的描述

## Comments
