# 01: `todo_write` 写入并在 resume 后恢复

**What to build:** 模型调用 `todo_write` 写下完整 Todo List，收到一行计数结果；frontend 经 `tool_state_changed` 事件与 `session.toolState("todo")` 读到当前清单；session resume 后清单原样恢复，单条坏记录不影响 resume。顺带落地 Tool State 地基的最小实现，由本用例驱动。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

参考：[spec](../spec.md)「Tool State 地基」「`todo_write` 工具」。

Agent Core：

- [ ] 新概念目录 `tool-state`，经其 `index.ts` 暴露；Tool State 定义含 name、version、parse（版本 + schema 校验）
- [ ] 写入为 pi `custom` entry：`customType: "tool-state/<name>"`，`data: { version, value }`，与消息同在 `main` 分支按序穿插
- [ ] 回放：每个 name 取最后一条 parse 成功的快照；parse 失败的记录跳过并经 `onWarning` 告警，session 照常 resume
- [ ] `@neant/shared` 新增 `tool_state_changed { name, value }` SessionEvent，写入时发出
- [ ] `Session.toolState(name)` 返回当前值，无记录时 undefined
- [ ] `todo_write({ todos: [{ content, status }] })`：默认启用（TUI 与 Headless CLI 都有），任何 Permission Mode 下不走审批；条目不允许额外字段
- [ ] content trim 后非空且不重复，否则工具错误；不限 `in_progress` 个数；`[]` 清空
- [ ] 结果文本 `Updated todo list: N pending, N in progress, N completed.`
- [ ] description 采用 deepseek-harness `tool-todo` 并行版文案并注明来源
- [ ] Tool State `todo` version 1，parse 校验数组 / 字段 / 状态枚举，不校验 `in_progress` 个数

测试（seam 1：`createSession` + fake model）：

- [ ] 写入结果文本、错误用例、清空
- [ ] `tool_state_changed` 事件与 `toolState("todo")`
- [ ] 新建 Session 读回同一 session 后 `toolState("todo")` 恢复
- [ ] JSONL 追加一条 parse 失败的 `tool-state/todo` 后 resume：退回上一条有效快照并触发 `onWarning`
