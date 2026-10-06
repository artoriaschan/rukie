Status: ready-for-agent
Blocked by: [04](04-goal-tool-separation.md)

# 05：Subagent 能力聚合与四个工具适配

## What to build

将完整 Subagent 能力聚合到 tools/subagents/，controller 提供已有操作所需的事实接口，同目录 tools.ts 拥有 subagent、subagent_fork、send_message、list_agents 的 schema、描述与结果包装。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

packages/agent/src/subagents/ 整体迁至 tools/subagents/，按 controller.ts、types.ts、状态定义与 tools.ts 分工；更新 Session、恢复模块、包导出和其他消费者。

## Acceptance Criteria

- [ ] 领域返回 child id、后台启动/既有 child/活跃投递事实、前台 RunResult 和列举所需身份/活动事实；tools 转为原 content/details/isError。
- [ ] 当前默认类型、未知类型错误、已删除类型 fallback、fork 特殊类型与动态 description 顺序/刷新行为不变。
- [ ] 运行名额和 AbortController 在 await 创建子 Session 前预留；创建失败释放并唤醒；迟到创建使用已中止的 signal。
- [ ] 每 child 只有领域持有的一条发送队列，轮到执行时重新判断 active；finally 释放自己的队列节点，不在工具包装另建队列。
- [ ] 保留子 Run Outcome 写父摘要、usage 结算、后台通知、取消压制与 running/wake 的原先顺序。
- [ ] settle 覆盖尚未产生 done promise 的创建项；restore 保留同 id 的现有 handle，并保留通知清理。
- [ ] Session 继续拥有子 Session 构造、资源和父子协调；不引入通用 controller 框架或新的运行单位。
- [ ] 普通/fork 子 Session 的 MCP OAuth 保留 child origin、授权后真实工具刷新与父子凭据共享；默认类型仅继承父 Session 已可用 server，显式 type.tools 含 authenticate-only 限制仍是精确白名单。缺失回调时隐藏授权工具，取消授权保持原非错误结果。
- [ ] 从 controller 移出工具对象与模型结果包装到同目录协议适配；删除顶层 subagents/ 旧归属，保持包公开 Subagent 类型、事件和恢复协议，全部消费者使用能力入口。

## Verification

01 协议基线；Subagents、Fork、Types、Permission、Outcomes、Reconciliation、Job 子运行清理、父/单 child 取消、前后台与 send_message 的现有公开套件。

复用 packages/agent/tests/e2e/subagent-mcp-oauth.test.ts 验证上述 OAuth 与继承场景；测试清单与迁移前专项审计证据见 Spec。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

逐项报告结果、类型刷新、发送串行、创建中取消和结算证据；不得仅通过名称/接口静态检查宣称时序不变。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
