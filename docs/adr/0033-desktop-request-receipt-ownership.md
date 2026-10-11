---
status: accepted
---

# Agent Core 拥有 Run 完成，server FiberMap 只等待输入回执

## 问题

同一个 Session 的一次 Run 可以包含多个排队或 steer 的人类输入。每个输入有独立 requestId，但 Run 的执行、结果与摘要由 Session 统一结算。把 server FiberMap 的一个 Session 键当作 Run 所有者，会让后续输入替换前一个等待者，也会把 abort 的资源清理与 Core 完成记录割裂。

## 决定

本决定部分替代 [ADR-0030](0030-desktop-server-hono-and-effect.md) 的 Session-keyed Run Fiber 与 abort 移除 Fiber 规则。Hono、单个 ManagedRuntime、Layer 与 Effect 只在 server 内部的边界保持有效。

Agent Core Session 拥有 Run 执行和人类输入完成记录，Ledger 拥有因果结算，沿用 [ADR-0024](0024-adopt-pi-durable-harness.md) 和 [ADR-0011](0011-agent-module-ownership.md)。server 调用 `followUp` 取得 requestId，每个 requestId 在 FiberMap 中有一个 `waitForRequest` 等待者；它等待 Core 的完成记录，不合成结果或摘要。已完成的 Fiber 自动移除。

WS 断开只释放订阅，等待者与 Run 继续。abort 命令调用 `Session.abort()`，等待执行与完成记录结算，并交还未放入输入的原文、图片和顺序；相应回执等待者随请求结算结束。graceful shutdown 先等待所有 Session abort，再释放 runtime 和 Session。异常 Fiber 中断通过 AbortSignal 调用所属 Session 的 abort；server 不向 Core 引入 Effect 类型。

## 备选方案

保留一个 Session-keyed Fiber 并在新输入时替换它：每个输入需要独立回执，替换会中断同一 Session 的先前等待者。让 server 合成 Run 完成记录：重复 Agent Core 的执行与持久化责任，无法统一 headless、TUI 与 desktop 的恢复语义。

## 影响

FiberMap 的条目数是尚未结算的输入回执数，不是 Session 或 Run 数。abort 的完成条件由 Core 的公开承诺决定，不能以移除 server Fiber 当作执行已停止的证据。公开 WS 回归覆盖多输入 abort 与断开后继续；实施证据归 [桌面端 spec](../../.scratch/desktop/spec.md)。
