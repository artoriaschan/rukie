Status: ready-for-agent
Blocked by: None

# 01：公开工具协议与 Plan Mode 时序基线

## What to build

先在未迁移的 Agent Core 上建立模型可见工具声明基线，核查并补齐明确的 Plan Mode 时序缺口，为后续职责变动提供可重复的公开行为证据。本票只增加必要测试与确定性 fixtures，不修改生产行为。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。这是第一票；先核查当前代码与既有测试基线。

## Scope

packages/agent/tests/e2e/ 与现有 tests/helpers/。复用 createSession、fake model、隔离项目和 homeDir；测试类型与命名沿用 Bun 公共行为套件。

## Acceptance Criteria

- [ ] 通过模型调用上下文断言名称、description、完整 parameters schema 与工具顺序；覆盖顶层默认及提供交互回调的工具集。
- [ ] 覆盖普通/fork 子 Session、子类型过滤、父 MCP server 继承与确定性动态类型描述；确认 Run 前和 Turn 准备时各自的刷新契约。
- [ ] 缺少 onQuestion/onPlanReview 等回调的工具可用性由公开行为断言，保持 Headless 安全默认。
- [ ] 核查 Plan Mode 多个待写 revisions 的较早失败/较晚成功及较早成功/较晚失败组合，验证最新状态、失败传播和后续可写。
- [ ] 覆盖父 Rewind 后同一已有 child handle 经 send_message 继续运行时的 Plan Mode 投影、提醒与无独立子 snapshot。
- [ ] 直接复用既有结果、事件与持久化断言；不生成所有随机结果快照、不读取私有 controller 状态，不引入内部测试接口。
- [ ] 先在旧实现上验证；若暴露既有失败，记录证据并将行为修复单独处理，不能为了使基线通过修改生产语义或断言。

## Verification

Plan Mode、Plan Review、Enter Plan Mode、Subagent Types/Fork、Goal Tools、Todo 和 tools 的现有公开套件。新增失败场景使用既有 Store 注入与明确完成信号，不使用任意睡眠或真实用户配置。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

保存基线命令、场景和结果；说明哪些声明与时序由新增测试保护，哪些由现有用例保护。后续票使用此基线，不重新采集期望来接受新行为。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
