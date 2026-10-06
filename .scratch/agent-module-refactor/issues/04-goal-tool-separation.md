Status: ready-for-agent
Blocked by: [03](03-tool-ownership-migration.md)

# 04：Goal 能力聚合与内部协议分离

## What to build

将完整 Goal 能力迁至 tools/goal/，在同一目录内区分 controller、state 与 tool。create_goal/update_goal 的声明、输入校验与模型结果包装归 tool，controller 保留状态和续跑规则。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

packages/agent/src/goal/ 迁至 tools/goal/，内部按 controller.ts、state.ts、tool.ts 分工；更新 Session、包导出与全部消费者。

## Acceptance Criteria

- [ ] 工具名称、label、description、schema、参数错误码、JSON结果内容与 details 保持当前协议。
- [ ] directHuman/goalRound 判断与对现有 controller 的调用时机不变，目标状态和授权的不变量仍由拥有它们的模块执行。
- [ ] Goal controller 保留 create/edit/pause/resume/finish、持久化、armed 与续跑规则，顶层专属状态与工具保持。
- [ ] Goal round/wrapup 上下文属于续跑能力并继续由 Goal 生成；工具调用现有动作，不把它错误地移为另一份工具状态。
- [ ] 协议适配复用工具运行支持；同目录的 controller 不反向依赖 tool 或全局工具组装入口，能力 index.ts 对 Session 提供直接执行接口。
- [ ] 删除顶层 goal/ 的旧归属与废弃转导出，保留包公开 GoalView 和 Session Goal 接口。
- [ ] 更新 Session 消费、包导出和相关当前文档，删除旧工具实现及转导出。

## Verification

01 协议基线，goal-tools、Goal continuation、恢复、Subagent/Goal 隔离、权限与 Headless Goal 的现有公开套件。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

核对模型结果结构与现有错误码，记录正常完成、暂停/恢复、受阻和内部续跑触发的实际检查结果。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
