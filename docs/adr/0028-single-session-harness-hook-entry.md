---
status: accepted
---

# Session extension 是原生 Generation 与 Tool hook 的唯一入口

## 问题

能力深化后，Goal、Subagent、Plan Mode 等能力需要在模型请求前、Run 结束边界和工具执行前后运行自身规则。pi-durable 允许每个 extension 各自注册 `beforeRequest`、`onYield`、`beforeTool`、`afterTool` 等 hook，能力也可以随自己的 extension 挂接，从而让 Session 不再知道这些规则。

已锁定 pi-durable 1.0.4 的组合规则限制了这种做法：同名 hook 按 `configure` 选择的 extension 顺序串行执行；`onYield` 与 `beforeCompact` 取第一个非空决定，`beforeTool` 取第一个 block，`beforeRequest` 与 `afterTool` 依次传递结果；非 abort 错误由调度器上报后继续下一个 handler。`onYield` 只能表达“续跑”或“不表态”，没有否决。Rukie 的 Run 边界依赖否决：本 Request 引发的子代理仍在运行，或 Stop hook 要求停止时，Goal wrap-up 等后续续跑都不能发生。

## 决定

每个 Conversation 只由 Session 组装的 extension（root 为 `rukie.session`，child 为 Conversation Runtime 产出的 extension）注册原生 Generation、Tool 与 Compaction hook。能力 extension 只注册自身 task 与工具，不注册这些 hook。

能力把各自规则提供为普通接口，由 Session 在 hook 内按固定顺序调用，例如 Goal 的轮次计数与 wrap-up。前置判断提前返回即构成否决；续跑优先级、相互依赖的状态读写及失败后的中止都写在同一段顺序代码中。规则的实现、状态与测试仍归所属能力，符合 [ADR-0011](0011-agent-module-ownership.md) 的能力归属与依赖方向。

本决定沿用 [ADR-0024](0024-adopt-pi-durable-harness.md) 以原生 extensions 与 hooks 接入自有能力的选择，只约束 hook 的注册位置。升级 pi-durable 后，如果 hook 组合提供显式否决、优先级与失败语义，可以重新评估。

## 备选方案

- 能力在各自 extension 注册 hook：locality 最强，Session 不需要知道能力时机，也是 pi-durable README 示例的用法。未采用：`onYield` 无法否决后续 handler，优先级隐含在 extension 数组位置，一个 handler 失败后依赖它的 handler 仍会运行；要补救只能让能力反向读取 Session 状态。
- 能力注册 hook，并通过共享状态协调否决与顺序：保留注册位置，但把顺序依赖分散到多个 module 的共享标志中，失败与恢复时更难推理。未采用。

## 影响

Session 的 hook 代码保留各能力的调用点，阅读一个 hook 就能看到完整的顺序与否决条件。新增需要 Run 边界或工具前后时机的能力，必须提供接口并修改 Session 的调用顺序，不能只靠注册 extension 生效。能力规则通过自身接口直接测试；调用顺序与否决由 Session 的公开 Run 行为验证。

实施与验证见 [Agent Core 深化重构](../../.scratch/agent-deepening/spec.md)。
