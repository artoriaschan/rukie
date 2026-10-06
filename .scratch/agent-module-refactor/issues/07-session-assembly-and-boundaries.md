Status: ready-for-agent
Blocked by: [06](06-plan-mode-controller.md)

# 07：Session 工具组装整理与导入方向约束

## What to build

在 Session 内部整理已有工具选择、组合与刷新，落实模块边界 lint 和正式工程文档；不改变运行架构。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

packages/agent/src/session/tools.ts、tools/入口、.oxlintrc.json、AGENTS.md、docs/architecture.md 与 ADR-0011 的迁移状态。

## Acceptance Criteria

- [ ] 按能力工厂组装，工具组装接受当前能力与查询，不持有另一份 Session 状态或接收全部能力的大工厂。
- [ ] 保留启动、Run前、Turn准备的不同刷新范围；基础工具/Plan/Goal先构造再发现子类型，最后加入Subagent、过滤和计量包装。
- [ ] 回调缺失、顶层/子身份、子类型、fork继承、当前MCP server映射/继承过滤及动态description保持。
- [ ] Hook 独立只读工具构造、MCP连接与协议适配生命周期保持，例外通过具体支持入口消费。
- [ ] 现有 Oxlint 拒绝能力内部 controller/registry/state 反向导入自身协议适配或全局工具组装入口，以及通用 Tool State 导入具体状态定义；不禁止整个 tools 目录的消费。
- [ ] Session 直接使用能力入口，Bash 使用 Jobs registry、恢复模块使用 Subagent 事实、MCP 和 Hook 合法调用均可通过；Agent Core 能力不导入 Frontend 屏幕、组件或命令解析。
- [ ] 以受控临时违规输入验证路径和必要导入名称规则，清理输入；不宣称字符串检查能识别完整传递依赖图。
- [ ] 审查入口转导出和旧目录残留，更新当前架构职责与扩展规则，移除ADR迁移状态中已不成立的描述。
- [ ] 保持根CLAUDE.md相对软链接，不新增领域术语或依赖。

## Verification

01 动态工具协议基线，MCP发现、Hooks模型、子类型/权限/fork过滤、Interaction缺失和相关Session生命周期公开用例；运行lint的违规/合法例外验证、类型与Knip。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

记录规则实际命中和合法例外、完整工具刷新对照、删除清单、文档路径和软链接检查。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
