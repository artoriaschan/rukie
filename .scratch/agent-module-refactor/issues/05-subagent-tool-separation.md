Status: resolved
Blocked by: [04](04-goal-tool-separation.md)

# 05：Subagent 能力聚合与四个工具适配

## What to build

将完整 Subagent 能力聚合到 tools/subagents/，controller 提供已有操作所需的事实接口，同目录 tools.ts 拥有 subagent、subagent_fork、send_message、list_agents 的 schema、描述与结果包装。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

packages/agent/src/subagents/ 整体迁至 tools/subagents/，按 controller.ts、types.ts、状态定义与 tools.ts 分工；更新 Session、恢复模块、包导出和其他消费者。

## Acceptance Criteria

- [x] 领域返回 child id、后台启动/既有 child/活跃投递事实、前台 RunResult 和列举所需身份/活动事实；tools 转为原 content/details/isError。
- [x] 当前默认类型、未知类型错误、已删除类型 fallback、fork 特殊类型与动态 description 顺序/刷新行为不变。
- [x] 运行名额和 AbortController 在 await 创建子 Session 前预留；创建失败释放并唤醒；迟到创建使用已中止的 signal。
- [x] 每 child 只有领域持有的一条发送队列，轮到执行时重新判断 active；finally 释放自己的队列节点，不在工具包装另建队列。
- [x] 保留子 Run Outcome 写父摘要、usage 结算、后台通知、取消压制与 running/wake 的原先顺序。
- [ ] settle 覆盖尚未产生 done promise 的创建项；restore 保留同 id 的现有 handle，并保留通知清理。（`settle` 子句保留但**不可独立区分**：公开行为无法与"settle 只等待已有 done"区分；`restore` 与通知清理子句成立，由 `subagent-outcomes.test.ts` Rewind 用例与 `subagent-directory.test.ts` 恢复用例覆盖，见评论）
- [x] Session 继续拥有子 Session 构造、资源和父子协调；不引入通用 controller 框架或新的运行单位。
- [x] 普通/fork 子 Session 的 MCP OAuth 保留 child origin、授权后真实工具刷新与父子凭据共享；默认类型仅继承父 Session 已可用 server，显式 type.tools 含 authenticate-only 限制仍是精确白名单。缺失回调时隐藏授权工具，取消授权保持原非错误结果。
- [x] 从 controller 移出工具对象与模型结果包装到同目录协议适配；删除顶层 subagents/ 旧归属，保持包公开 Subagent 类型、事件和恢复协议，全部消费者使用能力入口。

## Verification

01 协议基线；Subagents、Fork、Types、Permission、Outcomes、Reconciliation、Job 子运行清理、父/单 child 取消、前后台与 send_message 的现有公开套件。

复用 packages/agent/tests/e2e/subagent-mcp-oauth.test.ts 验证上述 OAuth 与继承场景；测试清单与迁移前专项审计证据见 Spec。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

逐项报告结果、类型刷新、发送串行、创建中取消和结算证据；不得仅通过名称/接口静态检查宣称时序不变。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
- 2026-10-07：实施完成。`packages/agent/src/subagents/` 迁至 `packages/agent/src/tools/subagents/`：`controller.ts`（`createSubagentController`、`SUBAGENT_PROMPT`、执行事实类型）、`state.ts`（`subagentRunState`、`subagentsState`、`SubagentRun`、`SubagentIdentity`）、`types.ts`（原样搬迁的类型发现）、`tools.ts`（`createSubagentTools` 四个工具对象）、`index.ts`（能力入口）。消费者全部改为能力入口：`session/index.ts`（`createSubagentController` + 本地 `createSubagentTools`，工具按 `delegate, fork, send, list` 原名顺序展开）、`session-resume/index.ts`、`packages/agent/src/index.ts` 包导出、`tests/config/subagent-hooks.test.ts` 镜像导入；顶层 `subagents/` 已删除，仓库内无旧路径或旧 API 引用。

  事实接口与结果包装：领域返回 `SubagentDelegationFact`（`started` 含 `reused`，`completed` 含前台 `RunResult`）、`SubagentSendFact`（`steered` 或后台 `started`）与 `SubagentListing`（`id`/`description`/`active`）；`tools.ts` 还原原文字（`started subagent <id>`、`delivered to <id>`、前台 `result.text || result.error || ""` 与 `isError`、`(no subagents)`、`<id> [running|idle] — <description>`）与 details（后台/前台为 `{agentId, childSessionId}`，活跃投递为 `{}`）。未知类型、`At most 8 subagents can run at once.`、`Parent Run was aborted.`、`Unknown subagent: <id>` 仍在领域层抛出，经 `execute` 原样成为错误结果。

  时序证据（先写测试、在未改动实现上通过，再做变异验证）：
  - 创建失败释放名额并唤醒：`subagents.test.ts`「a failed child creation releases its run slot and wakes the waiting parent」= 同一 Turn 8 个 `model: missing/type` 委派全部 `Unknown model "missing/type".`，下一 Turn 前台 general-purpose 委派成功返回子会话文本；变异（catch 中删除 `running.delete(key)` 保留 `wake()`）→ 该测试 5002ms 超时失败，证明释放与唤醒均为必要行为。
  - 迟到创建使用已中止 signal：同文件「parent cancellation during child creation settles the late child without a model request」= 用门控 Store 使子 Session 创建停在 `store.create`，此时 abort 父 Run，再放行创建；断言无任何子模型请求（fake model contexts 中无子 system prompt）、父 Run 拒绝、无通知（仅 1 条 user 消息）、子 Session 以 `parentSessionId` 落盘、`toolState("subagents")` 为 `{description: "Late", type: "general-purpose", latestRun: {outcome: "aborted"}}`（父摘要写入 + 迟到子 Run 以 aborted 收束）。变异（`abort()` 不再 abort 已预留的 controller）→ 出现 1 次子模型请求，测试失败。
  - 发送串行：队列只在 controller（`sending`），工具包装无第二份队列；`subagent-directory.test.ts`「parallel messages to an idle cold child start one Run and steer the following message」（并行两条 send 只启动 1 次子 Run，第二条改为 steer）、「send_message steers the active child before its next model request and list_agents reports running」（steer 结果 details 为 `{}`）、「an idle continuation is rejected at eight running children while active steering remains available」（轮到执行时重判 active：8 个运行中仍可 steer，空闲续跑报 `At most 8`）通过。

  命令与结果（worktree `/Users/artorias_chan/.zcode/worktrees/agent-module-refactor-05/Neant`，基点 619e797，提交 33383f3 + 0c72bf2）：
  - `env -u NO_COLOR bun test packages/agent/tests/e2e/subagents.test.ts subagent-fork.test.ts subagent-types.test.ts subagent-permissions.test.ts subagent-outcomes.test.ts subagent-reconciliation.test.ts subagent-jobs.test.ts subagent-hooks.test.ts subagent-directory.test.ts subagent-mcp-oauth.test.ts checkpoint-subagents.test.ts job-api.test.ts tool-declarations.test.ts packages/agent/tests/config/subagent-hooks.test.ts`（按目录展开）→ 152 pass / 0 fail，966 expect，14 文件，exit 0。
  - `env -u NO_COLOR bun test packages/agent/tests` → 1385 pass / 0 fail，6027 expect，79 文件，exit 0。
  - `bunx --no -- oxfmt --check` → exit 0；`bunx --no -- oxlint` → exit 0（397 文件，0 warning / 0 error）；`bunx --no -- tsc -b` → exit 0；`bunx --no -- knip` → exit 0（迁移中曾报告能力入口 4 个无消费者类型转导出，已删除后通过）。

  其他覆盖：MCP OAuth（child origin、授权后真实工具刷新、父子凭据共享、取消授权保持原非错误结果、authenticate-only 精确白名单、默认类型仅继承父已可用 server）由 `subagent-mcp-oauth.test.ts` 4 项通过；类型默认值/未知类型/已删除类型 fallback/fork 特殊类型由 `subagent-types.test.ts`、`subagent-directory.test.ts` 通过；动态 description 内容、顺序与逐 Run 刷新由 `tool-declarations.test.ts` 基线用例通过；Run Outcome 写父摘要、usage 结算、后台通知与取消压制由 `subagent-outcomes.test.ts`、`subagents.test.ts` 通过；`restore` 保留同 id handle 与通知清理由 `subagent-outcomes.test.ts` Rewind 用例与 `subagent-directory.test.ts` 恢复用例通过；Session 仍持有子 Session 构造（`createChild`）、`childSessions`/dispose 资源与 `begin/abort/settle/restore/delivered/count/hasNotifications/wait/interrupt` 协调。

  未能验证/限制：
  - `settle()` 对「尚无 done promise 的创建项」的等待分支按原样保留，但用公开行为无法与「settle 只等待已有 done」区分：父 Run 必须等 `execute` 返回（即创建完成并已挂上 done）才能结束，变异该分支后新测试仍通过；仅能确认该分支代码路径保留、且失败释放路径下的唤醒为必要（上述变异 A）。AC 第 6 项据此取消勾选（保留删除线原文），`Status` 仍为 `resolved`，表示交付完成、该子句未被证据区分。
  - 本票未改动 `docs/architecture.md`（其中 `subagents/` 归属描述仍为迁移前状态），按实施请求归票 07 同步。
  - 未运行 `bun run check` 聚合检查（按实施请求保留给最终票）。

- 2026-10-07（票 08 复核，集成点 `ba200b7`，worktree `agent-module-refactor-08`）：逐条独立核对本票证据，结论为**证据成立，但有一处数字需要更正**。

  内容保持核对：把 `git show 5c730be:packages/agent/src/subagents/index.ts` 按区间切开与新文件 `diff`，`parseRun` + `subagentRunState` + `subagentsState` 区间 81 行逐字节相同（`SubagentRun` 与 `SubagentIdentity` 只是位置从 `SUBAGENT_PROMPT` 前后移到文件首尾，声明内容不变）；`tools/subagents/types.ts` 相对 `subagents/types.ts` 只有 1 行导入路径改动（`../hooks/index.ts` → `../../hooks/index.ts`，blob `dd7c54a` → `718c78a`）。`tools/subagents/tools.ts` 的四个工具 name/label/description/parameters 与原文逐字相同，`delegate` 的 description 由原来的 `setTypes` 赋值改为 getter（`get description()` 读 `subagents.types()`），声明内容与刷新时机由冻结基线 `tool-declarations.test.ts` 第 ⑦⑩ 项覆盖（该文件 blob `7e7ccb33…` 自 `8a6d5b7` 起未改）。

  数字更正：本票原文写"由 `subagent-mcp-oauth.test.ts` 4 项通过"。该文件在 `ba200b7` 实跑为 **6 项**：`test.each(["subagent","subagent_fork"])` 两组各展开 2 项（child origin + 授权后真实工具 + 父子凭据共享 / Headless 无授权工具），加 `a child's cancelled OAuth interaction remains non-error…` 与 `an authenticate-only type keeps its exact restriction after logging in` 两项。命令：`env -u NO_COLOR bun test packages/agent/tests/e2e/subagent-mcp-oauth.test.ts` → 6 pass / 0 fail，exit 0；文件 blob 在 `5c730be` 与 `ba200b7` 均为 `904b5e72c407ee9a3ef70b8c0f91b3fbe57318c4`（断言零改动）。该文件覆盖 AC 中的 child origin / 授权后刷新 / 凭据共享 / 取消非错误 / authenticate-only 白名单；"默认类型仅继承父已可用 server"与"显式白名单排除继承 MCP 工具"由冻结基线 `tool-declarations.test.ts` 第 ⑦⑧ 项覆盖，不是同一个文件。

  本票声称的 5 个用例名逐一存在：`git grep -F` 命中 `a failed child creation releases its run slot and wakes the waiting parent`、`parent cancellation during child creation settles the late child without a model request`、`parallel messages to an idle cold child start one Run and steer the following message`、`send_message steers the active child before its next model request and list_agents reports running`、`an idle continuation is rejected at eight running children while active steering remains available`（分别在 `subagents.test.ts`、`subagent-directory.test.ts`）。

  `a4b16f4`「remove duplicated assertions in the late child cancellation case」只删除本票**新增**用例中重复粘贴的 3 行（同一 `expect(await rejected).toBeInstanceOf(Error)` 与同一注释各出现两次），未触碰任何既有断言：`git show a4b16f4 --stat` = 1 file changed, 3 deletions(-)。

  复核运行的命令与结果：`env -u NO_COLOR bun test packages/agent/tests` → 1390 pass / 0 fail，6046 expect，79 文件，exit 0（本票基点记录为 1385 pass / 6027 expect / 79 文件；差值来自票 06 新增的 5 项 Plan Mode 用例，非本票行为变化）。`bunx --no -- oxlint` exit 0（398 文件，0/0）、`bunx --no -- tsc -b` exit 0、`bunx --no -- knip` exit 0、`bunx --no -- oxfmt --check` exit 0（694 文件）——这些由票 08 在集成点重跑，与票内记录一致。

  仍保留的限制（本票已披露，票 08 未使其可独立区分）：`settle()` 的"尚无 done promise 的创建项"分支仍只能证明代码路径保留，用公开行为无法与"settle 只等待已有 done"区分；创建失败释放名额与唤醒这一半由变异验证（删除 `running.delete(key)` → 用例 5002ms 超时失败）区分，该变异结论未在票 08 重放，属于本票自证。
