Status: ready-for-agent
Blocked by: [01](01-public-contract-baseline.md)

# 02：工具适配与基础工厂分离

## What to build

将工具执行适配、错误结果包装和基础/只读工具构造从混合入口分离，保留原公开声明与 pi 运行行为，为后续工具迁移提供稳定构造位置。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

packages/agent/src/tools/index.ts 及 tools/runtime.ts、tools/builtin.ts；更新 mcp/index.ts、hooks/model.ts 和所有当前消费者。

## Acceptance Criteria

- [ ] tools/index.ts 保留工具工厂/交互类型入口，实际共享 pi context/AbortSignal 适配和 preserveErrorDetails 独立维护。
- [ ] 保留 read 原始字节图片准入、home/path 参数准备、pi 二次规范化、错误码与 params 结果，以及取消行为。
- [ ] MCP 直接消费实际所需的错误包装，Hook 消费独立只读工具集；均不为了 helper 加载整个工具组装入口。
- [ ] 保留 MCP authenticate 工具使用 preserveErrorDetails 的错误路径与原始 MCP 工具的适配路径；不将错误包装无差别增加到所有 MCP 工具。复用 OAuth、配置错误与生命周期公开套件验证迁移。
- [ ] 基础工具集与 Hook 只读工具集具有独立工厂，原工具名称、参数、顺序和隐藏条件保持。
- [ ] 保留 tools/path.ts 现有职责，当前没有跨领域消费者，不为假设复用另建抽象。
- [ ] 更新当前消费者与包类型转导出，删除搬迁后废弃实现；不留下临时破坏等待下一票。

## Verification

01 的协议基线，以及 tools、image read、路径规则、MCP、Agent Hook 模型、取消与 coded error 的现有公开套件。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

记录实际测试与静态检查结果，核对错误 details 的 Transcript 持久化及恢复行为，并说明 MCP/Hook 的合法工具消费路径。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
