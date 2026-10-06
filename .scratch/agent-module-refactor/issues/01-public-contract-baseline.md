Status: resolved
Blocked by: None

# 01：公开工具协议与 Plan Mode 时序基线

## What to build

先在未迁移的 Agent Core 上建立模型可见工具声明基线，核查并补齐明确的 Plan Mode 时序缺口，为后续职责变动提供可重复的公开行为证据。本票只增加必要测试与确定性 fixtures，不修改生产行为。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。这是第一票；先核查当前代码与既有测试基线。

## Scope

packages/agent/tests/e2e/ 与现有 tests/helpers/。复用 createSession、fake model、隔离项目和 homeDir；测试类型与命名沿用 Bun 公共行为套件。

## Acceptance Criteria

- [x] 通过模型调用上下文断言名称、description、完整 parameters schema 与工具顺序；覆盖顶层默认及提供交互回调的工具集。
- [x] 覆盖普通/fork 子 Session、子类型过滤、父 MCP server 继承与确定性动态类型描述；确认 Run 前和 Turn 准备时各自的刷新契约。
- [x] 在迁移前验证 spec 列出的 MCP 快照/API 与 Subagent OAuth 既有公开套件，保留原断言；记录公开类型、刷新、事件、child origin 和工具继承契约，只有真实缺口才新增测试。
- [x] 缺少 onQuestion/onPlanReview 等回调的工具可用性由公开行为断言，保持 Headless 安全默认。
- [x] 核查 Plan Mode 多个待写 revisions 的较早失败/较晚成功及较早成功/较晚失败组合，验证最新状态、失败传播和后续可写。
- [x] 覆盖父 Rewind 后同一已有 child handle 经 send_message 继续运行时的 Plan Mode 投影、提醒与无独立子 snapshot。
- [x] 直接复用既有结果、事件与持久化断言；不生成所有随机结果快照、不读取私有 controller 状态，不引入内部测试接口。
- [x] 先在旧实现上验证；若暴露既有失败，记录证据并将行为修复单独处理，不能为了使基线通过修改生产语义或断言。

## Verification

Plan Mode、Plan Review、Enter Plan Mode、Subagent Types/Fork、Goal Tools、Todo 和 tools 的现有公开套件。新增失败场景使用既有 Store 注入与明确完成信号，不使用任意睡眠或真实用户配置。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

保存基线命令、场景和结果；说明哪些声明与时序由新增测试保护，哪些由现有用例保护。后续票使用此基线，不重新采集期望来接受新行为。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
- 2026-10-07：实施完成（`8a6d5b7`，父提交 `5c730be`，即未迁移基线）。本票只新增测试，未改生产代码。因实施时未追加证据评论，本条由票 08 在集成点 `ba200b7` 逐条复核后补记；所有命令均在票 08 worktree 实际运行。

  新增 `packages/agent/tests/e2e/tool-declarations.test.ts`（10 项）：`BASELINE` 是 21 个内置工具与 `mcp__local__echo` 的**字面量**声明（description 与完整 `parameters` JSON schema），声明注释明确"不是从工具工厂读回的值，迁移不能重定义它要保护的协议"；`declared()` 用 `getCurrentTools(messages)` 从 provider 请求上下文回放声明，`deltas()` 读 system 消息的 `toolsAdded`/`toolsRemoved`。用例：① 顶层声明冻结名称、description、schema 与顺序；② 无 Interaction 回调时只隐藏 question 与 plan 工具（并断言 `session_start` 事件的 `tools` 与模型可见一致）；③ 无自有工具的子类型继承父声明；④ `subagent_fork` 继承父声明；⑤ `explore` 类型只声明只读白名单；⑥ 显式 `tools` 白名单精确生效；⑦ 连接 MCP server 后追加到父与继承子；⑧ 显式白名单排除全部继承 MCP 工具；⑨ 启动 seed → Run 开始追加 MCP 声明 → Turn 准备不再重复声明（`deltas(fake.contexts[1])` 与 `contexts[0]` 相同），且 `session_start` 事件报告 Run 前可执行顺序；⑩ 后续 Run 依据最新发现的类型重建 `subagent` description，其余工具位置不变。

  `plan-mode.test.ts` 追加 2 项时序用例（该文件现 18 项）：`:383` 同一 Turn 内排队两个 revision，分别覆盖"较早失败/较晚成功"与"较早成功/较晚失败"两种顺序，断言各自 reject/settle、最新内存状态、注入的 `plan-mode` 提醒文本、以及失败后仍可再次写入与 resume 后的状态；`:452` 父 Rewind 后经同一 child handle `send_message` 继续运行，断言子 Session 读到父投影的 Plan Mode、无独立子 snapshot。

  声明冻结证据（blob `7e7ccb33304a805385ab4848ca128489b4fc917d`）：该文件在 `5c730be` **不存在**，由本票 `8a6d5b7`（父提交 `5c730be`）创建；`git rev-parse <commit>:packages/agent/tests/e2e/tool-declarations.test.ts` 在 `8a6d5b7 b8a1212 470d4b9 f96cd9d 0c5dc22 619e797 33383f3 0c72bf2 bc88d33 340aa1a ba200b7` 全部返回同一 blob，即票据 02–07 与 main 合并均未改动它。因此"迁移后协议未变"不是靠重新采集期望，而是靠同一份字面量期望在迁移前后都成立。

  MCP 快照/API 与 Subagent OAuth 既有套件：`mcp-api`、`mcp-config`、`mcp-oauth`、`mcp-oauth-lifecycle`、`subagent-mcp-oauth`、`job-api`、`subagent-jobs` 七个文件在 `5c730be` 与 `ba200b7` 的 blob 逐一相同（如 `mcp-api` = `cd1d13085cc6bc293cb2250d1646bd8c01ecfe65`、`subagent-mcp-oauth` = `904b5e72c407ee9a3ef70b8c0f91b3fbe57318c4`），即断言零改动。

  命令与结果（worktree `agent-module-refactor-08`，`ba200b7`，测试按仓库要求 `env -u NO_COLOR`）：
  - `env -u NO_COLOR bun test packages/agent/tests/e2e/tool-declarations.test.ts` → 10 pass / 0 fail，exit 0。
  - `env -u NO_COLOR bun test packages/agent/tests/e2e/plan-mode.test.ts` → 18 pass / 0 fail，exit 0。
  - `env -u NO_COLOR bun test <上述 7 个 MCP/Job 套件>` → 112 pass / 0 fail，7 文件，exit 0。
  - `env -u NO_COLOR bun test`（7 套件 + `tool-declarations`）→ 122 pass / 0 fail，8 文件，exit 0。

  未能验证/限制：
  - 本票没有留下自己的实施证据评论，也没有记录"是否暴露既有失败"。票 08 只能证明基线测试是在未迁移提交上编写并提交的（`8a6d5b7^` = `5c730be`，且早于任何重构实现提交 `b78dbdf`），无法在集成 worktree 内重放"在旧实现上先运行"的日志——重放需要在 `5c730be` 检出并运行，超出本 worktree 的 Git 范围。未找到任何既有失败记录，即 AC 中"若暴露既有失败，记录证据"的**否定分支无记录**，不能据此宣称当时无失败。
  - 预迁移审计记录的"654 次断言"在本套件上不可复现为稳定计数：同一组 7 个文件连续运行得到 654/656/657/658 次 `expect()`（`mcp-api.test.ts` 等含 `if (event.type === "mcp_servers_changed")` 一类时序条件断言）。通过/失败数与退出码稳定（112/0，exit 0），文件 blob 又是逐字节相同，故以 blob 相同 + 112 pass/0 fail 作为断言未变的证据，断言计数不作为信号。
