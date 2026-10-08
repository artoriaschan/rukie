---
status: accepted
---

# Tool Search 在客户端执行，经 pi 原生工具变更加载 Deferred Tool

## 问题

MCP 工具数量随用户配置增长，全部工具定义常驻模型上下文会挤占窗口、拉高每轮输入成本。需要让模型只在需要时看到 MCP 工具定义，同时保持前缀缓存、跨 provider 行为一致，并让模型可见输入能从 Transcript 重建。锁定的 pi 1.0.4 不提供搜索工具，也不透传 Anthropic 服务端 tool search。

## 决定

Rukie 提供客户端 `ToolSearch` 工具：在本地检索 Deferred Tool，命中后由工具结果的 `ToolControl.addTools` 加入当前对话的可用工具；pi-ai 在 Anthropic 用 `tool_addition` 块、在 OpenAI Responses 用 transcript 锚定的 `tool_search_output` 送达定义。顶层工具列表在对话中保持不变，新增定义只追加在发现位置之后。

已发现集只由 Transcript 中的工具变更推导，不另存 Tool State；compaction 基线、Rewind 和子 Session 因此各自得到一致结果。只有 MCP 工具（不含 `authenticate`）可成为 Deferred Tool。

只有模型 compat 声明 `supportsMidConvoToolChanges`（Anthropic）或 `supportsToolSearch`（OpenAI Responses）时才启用；否则每次发现都会改写顶层工具列表、使前缀缓存失效，Tool Search 不启用，所有工具照常可见。

规格与实施：[Tool Search 规格](../../.scratch/tool-search/spec.md)。

## 备选方案

- Anthropic 服务端 tool search（`tool_search_tool_regex` / `_bm25` 加逐工具 `defer_loading`）：需要 patch 或包装锁定的 pi-ai，违背 [ADR-0024](0024-adopt-pi-durable-harness.md) 的 harness 复用；只覆盖 Anthropic；检索在服务端进行，发现结果不作为 Rukie Transcript 事实。
- 对不支持对话中工具变更的模型照常启用：每次发现都会使整段前缀缓存失效，抵消节省的 token。
- 已发现集另存为 Tool State：与 Transcript 中的工具变更形成两份事实，resume 与 compaction 后可能分歧。

## 影响

启用后模型需要多一次工具调用才能使用未发现的 MCP 工具。Deferred Tool 名单经可追加 reminder 提供，`ToolSearch` 自身定义保持稳定。Rukie 的 loadout 同步必须保留已发现工具并保持顺序，否则 pi-durable 会整表移除再重加。检索质量取决于本地关键词打分，没有语义检索。
