# 03：归档 Session

Status: resolved

Blocked by: 01

**What to build:** 按 [spec](../spec.md#归档) 让用户从会话菜单归档 Session：Archived Session 从侧栏与搜索中隐藏，Transcript 与 Session Store 不变。

- [x] 桌面端应用数据库 registry 新增 `archived` Session id 列表，与 `pinned` 并列；`sessions_changed` 增加 `archived` 字段，store 校验并保存
- [x] 新增 wire 命令 `session.archive { sessionId }`：校验 Session 存在、未执行且无挂起交互；从 `pinned` 移除并加入 `archived`；保存后发出 `sessions_changed`，归档当前 Session 时携带 `closedSessionId`
- [x] `session.pin` 拒绝 Archived Session
- [x] 侧栏分组与现有搜索结果排除 Archived Session
- [x] 会话行右键、行内更多与标题栏“会话更多”加入“归档”；执行中或等待确认时禁用；归档当前 Session 后回到首页新聊天
- [x] zh 与 en 文案同步
- [x] 测试：server 测试覆盖归档、置顶移除、执行中拒绝、`closedSessionId` 与 `session.pin` 拒绝；store 测试覆盖 `archived` 解析与非法值；shell browser 覆盖侧栏与搜索隐藏、禁用状态、归档当前 Session 后回到新聊天

## Answer

registry 保存 `archived`，既有应用 registry 缺少该字段时仅补空列表，非法列表拒绝加载；`session.archive` 校验存在及执行事实，移除置顶并广播 `archived` 与 `closedSessionId`。执行保护包含 Run、admission、Queued Input、Background Job、子代理、挂起 Interaction 和打开过程，单纯订阅不阻止归档。`session.pin` 拒绝 Archived Session，Session 摘要、Transcript 与 SQLite 不变，未打开的 Session 不恢复执行。

侧栏、搜索、数字导航与历史导航排除 Archived Session；三个菜单入口共享归档定义，执行或权限等待时禁用。当前 Session 归档后取消订阅并回新聊天，其他 Session 归档保留当前对话；对应缓存视图失效。zh/en 与 server/UI README、wire JSDoc 同步，复用现有菜单，无新增组件或布局几何。

ADR coverage 沿用 spec 已记录的 ADR-0035：归档是应用组织信息，未触碰 Session 执行事实、存储布局或写者租约；菜单与本地化无需 ADR。无新架构取舍。

验证状态为 ticket03 的独立分支（基于 9b7d4870）及本工单 diff；父集成尚待合并。运行与实际结果：

- `bun test packages/server/tests/server.test.ts --test-name-pattern 'archive|Run, pending Interaction|a running Background Job'`：4 通过，1.171s；子代理保护单例 1 通过，895ms。
- `bun test packages/server/tests/storage/app-database.test.ts --test-name-pattern 'application state|registry adds archival'`：2 通过，496ms，覆盖归档持久化、旧文档保留及非法 archived 拒绝。
- `bunx --no vitest run tests/store/desktop.test.ts --project ui-node`：11 通过，324ms；随后缓存关闭差异的 archive 单例 1 通过，246ms。两项证据组合覆盖当前 store；未将增量单例称作全文件重跑。
- Chromium shell 最小范围包含当前归档导航/侧栏/搜索、三个入口禁用、归档其他 Session 及现有 pin/hover/focus/context：初次 3 通过、1 失败，18.23s。失败为原有单项菜单 ArrowDown 绕回 Unpin 的断言；新增 Archive 后正确焦点为 Archive，修改为期望新动作。受影响单例增量 1 通过，2.55s，其他三个成功结果复用。
- 变更文件 oxfmt、oxlint、`tsc -b packages/shared packages/server packages/ui`、`bun run check:docs`（147 Markdown 文件）、`git diff --check` 通过。命令均使用 `rtk proxy`，Vitest 从 packages/ui 用 Node/Chromium 运行。

详细日志与启动失败、TDD 红绿、增量有效性位于外部协调验证记录的 `03-verification.md`（`/tmp/rukie-session-sidebar-evidence/`）。ticket06 负责 aggregate static、desktop package 与最终 agent-browser 验收；CI 仍待最终集成提交验收，本工单 resolved 不表示 PR 已合并。

增量接线准备：context-menu 用例先用 typeahead 聚焦 Unpin，再按 ArrowDown 观察 Archive，避免随后 Rename 插入到首项使已有焦点断言依赖初始位置。仅该菜单单例重新验证，1 通过、17 跳过、3.13s（`03-menu-typeahead.log`）；其他运行证据继续复用。
