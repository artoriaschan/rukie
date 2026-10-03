# 01: `todo_write` 写入并在 resume 后恢复

**What to build:** 模型调用 `todo_write` 写下完整 Todo List，收到一行计数结果；frontend 经 `tool_state_changed` 事件与 `session.toolState("todo")` 读到当前清单；session resume 后清单原样恢复，单条坏记录不影响 resume。顺带落地 Tool State 地基的最小实现，由本用例驱动。

**Blocked by:** None (can start immediately)

**Status:** done

参考：[spec](../spec.md)「Tool State 地基」「`todo_write` 工具」。

Agent Core：

- [x] 新概念目录 `tool-state`，经其 `index.ts` 暴露；Tool State 定义含 name、version、parse（版本 + schema 校验）
- [x] 写入为 pi `custom` entry：`customType: "tool-state/<name>"`，`data: { version, value }`，与消息同在 `main` 分支按序穿插
- [x] 回放：每个 name 取最后一条 parse 成功的快照；parse 失败的记录跳过并经 `onWarning` 告警，session 照常 resume
- [x] `@neant/shared` 新增 `tool_state_changed { name, value }` SessionEvent，写入时发出
- [x] `Session.toolState(name)` 返回当前值，无记录时 undefined
- [x] `todo_write({ todos: [{ content, status }] })`：默认启用（TUI 与 Headless CLI 都有），任何 Permission Mode 下不走审批；条目不允许额外字段
- [x] content trim 后非空且不重复，否则工具错误；不限 `in_progress` 个数；`[]` 清空
- [x] 结果文本 `Updated todo list: N pending, N in progress, N completed.`
- [x] description 采用 deepseek-harness `tool-todo` 并行版文案并注明来源
- [x] Tool State `todo` version 1，parse 校验数组 / 字段 / 状态枚举，不校验 `in_progress` 个数

测试（seam 1：`createSession` + fake model）：

- [x] 写入结果文本、错误用例、清空
- [x] `tool_state_changed` 事件与 `toolState("todo")`
- [x] 新建 Session 读回同一 session 后 `toolState("todo")` 恢复
- [x] JSONL 追加一条 parse 失败的 `tool-state/todo` 后 resume：退回上一条有效快照并触发 `onWarning`

## Comments

2026-10-04：使用 `/Users/artorias_chan/.agents/skills/implement/SKILL.md`，按 `tdd` 的已约定 seam 1 分片 red → green 完成。新模块保存原生 pi custom 快照，状态仅随 session 生命周期保留。仅交付 01；reminder、compaction 重注入和 TUI 展示由后续票据负责。

验证证据：

- `rtk bun test packages/agent/tests/e2e/todo.test.ts`：17 pass / 0 fail。覆盖三种 Permission Mode、不审批、trim、多个进行中项、非法字段/状态/缺失字段/空内容/重复内容、整表替换、空表、状态事件与读取、resume，以及 8 类坏快照跳过和告警。各片首先观察到预期失败：工具不存在、非法内容被接受、resume 未恢复、坏记录导致 resume 抛错。
- `rtk proxy bunx tsc -b`：实现期间多次通过。
- `rtk proxy bun test apps/neant-cli/tests/e2e/cli.test.ts --test-name-pattern 'stream-json emits session metadata'`：1 pass / 0 fail；既有默认工具清单断言已加入 `todo_write`。
- `rtk bun test apps/neant-tui/tests/e2e/locale.test.ts --test-name-pattern 'non-interactive terminal guidance'`：3 pass / 0 fail。全量验收发现既有 guidance 测试未注入 homeDir，读取真实用户配置的 `locale=zh`；已仅在该测试注入临时 cwd/homeDir，不修改产品 locale 行为。
- `rtk proxy env -u NO_COLOR bun run check`：格式、lint、`tsc -b`、Knip、完整测试全部通过；689 pass / 0 fail，4307 assertions，57 files，96.90 秒。

## Standards

审查固定基点 `ab5ef4a061811a1c254faa965232f0cf656e41e3`，独立 Standards 子代理：0 actionable findings。符合模块边界、原生只追加 Session Store、测试运行时与 locale-agnostic Agent Core 约定；无值得修改的 baseline smell。

## Spec

独立 Spec 子代理：零项可执行发现。issue 01 的默认启用、免审批、规范化与校验、计数文本、状态事件/API、main 分支快照、last-wins 恢复与坏记录告警均符合要求；description 与参考实现并行版一致且注明来源。未发现本票范围扩张。

审查合计：Standards 0 项，Spec 0 项；两轴均无未解决问题。
