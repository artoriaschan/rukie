---
status: accepted
---

# tools 按能力聚合工具与执行实现，Session 负责协调

## 问题

同一工具能力的协议适配、执行规则、状态与资源需要集中维护，Session 继续协调运行。

## 决定

tools 表示 Agent Core 内置工具及其关联能力的集合，按能力聚合模型协议适配、执行规则、状态与资源管理。选择把 Goal、Jobs、Subagent、Plan Mode 的协议与执行实现放在同一能力目录，以便相关修改集中维护；代价是目录含义超出模型工具协议层，调用方必须使用明确的能力接口。

Bash、Web Fetch、Todo、Goal、Jobs、Subagent、Plan Mode 分别归 tools 内部能力模块。每个能力内部的协议适配负责工具声明、参数处理和模型结果包装，controller、registry 等执行模块负责规则、状态、并发与资源，返回执行事实。Session 可直接调用执行接口，不必经模型工具调用，继续协调 Run、存储、事件和生命周期。通用 Tool State 接收注册的具体定义，Permission Review 仍归权限模块。

工具按能力构造，Session 内部组装并保留现有动态刷新；Hook 消费独立只读工具集，MCP 发现与协议适配仍归 mcp，可复用工具错误包装。跨能力消费使用所属能力入口，例如 Bash 调用 Jobs registry。依赖限制针对能力内部：协议适配调用执行模块，执行模块不反向依赖自身协议适配或全局工具组装；通用状态机制不依赖具体状态定义。不禁止 Session 或其他能力导入 tools，沿用现有 Oxlint 验证明确的路径及导入名称约束。

这些能力属于 Agent Core，不导入 `@rukie/coding-agent` 或其内部路径，也不导入 Frontend 的屏幕、组件、输入命令解析或呈现状态。Frontend 通过 Session 查询、事实事件和 Interaction 回调使用能力；Session 注入存储与事件接口是 Core 内部协调，不是能力依赖 Frontend 实现。

本决定替代此前允许内置工具在所属领域、tools 或 Session 多处构造的组织约定，不替代 ADR-0002、ADR-0003、ADR-0009、ADR-0010 的运行、存储与恢复决定。迁移保留包公开接口、工具声明和结果、事件、Frontend 行为、Transcript 格式、取消和恢复时序。

### 实现位置

[实施规范](../../.scratch/agent-module-refactor/spec.md)记录对应交付证据。当前实现：Bash、Web Fetch、Todo、Goal、Jobs、Subagent 与 Plan Mode 的能力模块都位于 [`tools/`](../../packages/agent/src/tools/)，同名顶层目录、`tool-state/todo.ts` 与 `tools/index.ts` 已删除，各消费者直接使用所属能力的 `index.ts`。

[`session/tools.ts`](../../packages/agent/src/session/tools.ts) 按能力工厂组装启动、Run 前与 Turn 准备的工具集，Session 继续持有身份、子类型、MCP 快照与调度状态。[`.oxlintrc.json`](../../.oxlintrc.json) 拒绝能力执行模块导入自身协议适配、共享工具运行时适配层（`tools/runtime.ts`）或全局组装入口，通用 Tool State 导入具体状态定义，以及 Agent Core 导入 Frontend 实现；规则匹配配置的导入路径与名称，不校验完整传递依赖图。

## 备选方案

- 只把模型协议集中到 tools，领域能力保留顶层目录：协议层易于识别，但同一能力的修改跨两个目录。用户选择将关联能力一并归 tools，职责区分在能力目录内部落实。
- 只移动目录：调整查找位置，但 Subagent 仍返回工具结果、Plan Mode 行为仍集中在 Session，职责问题继续存在。
- 全面重构 Session：扩大到调度和恢复架构，增加对既有生命周期的影响。本次只提取已有明确的领域行为。

## 影响

tools 的含义包含关联执行能力；调用方通过明确的能力接口访问，导入规则的实际覆盖范围见决定正文。
