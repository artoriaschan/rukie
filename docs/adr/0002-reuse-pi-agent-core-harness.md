---
status: superseded
---

# 复用 pi-agent-core 的 harness 组件，不用 pi-coding-agent，也不完全自研

本决定已由 [ADR-0024](0024-adopt-pi-durable-harness.md) 替代：采用原生 durable 执行与恢复，移除旧 harness 和数据兼容。当前执行与持久化契约见 [Agent README](../../packages/agent/README.md#session-store)，整体交付验收见[规格与票据](../../.scratch/pi-durable-migration/spec.md)。下文保留历史取舍。

## 问题

Agent Core 需要模型循环、工具、上下文压缩与存储能力，并保持 Frontend 独立。

## 决定

在 `@earendil-works/pi-agent-core` 0.99.2 的基础上构建：直接复用其中的 `Agent` loop、hooks、`loadSkills`、read/write/edit/bash 工具（bash 已由 ADR-0010 改为自研）、compaction 和 session repo；MCP 用 `@earendil-works/pi-mcp`。自己实现的部分包括：System Prompt、System Reminder 注入、权限判定（挂在 `beforeToolCall` 上）、grep/glob 工具和 CLI。

## 备选方案

- 只用 pi-ai 和 loop，其余全部自研：可控，但要重写 pi 里已有的东西，工作量大。
- 基于 pi-coding-agent SDK：依赖太重（会带进 pi-tui、quickjs 等），存储也被绑定在它的 JSONL 格式上。

## 影响

依赖锁定的 pi API，升级时需要核对其工具、生命周期和持久化行为；自研能力的范围由后续 ADR 明确。
