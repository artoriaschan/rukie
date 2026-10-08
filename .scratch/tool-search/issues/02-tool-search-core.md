# 02: Tool Search 核心

**What to build:** `toolSearch` 设置、启用判定、Deferred Tool 期望工具集、`ToolSearch` 工具和 `deferred-tools` reminder。启用时 MCP 工具（除 `authenticate`）作为 Deferred Tool，模型经 `ToolSearch` 加载后在对话中保持可调用；已发现集从 Transcript 推导，resume / compaction / rewind / 子 Session 行为照 spec。详见 [Tool Search spec](../spec.md) 的 Implementation Decisions 与 Testing Decisions。

Blocked by: 01

Status: ready-for-agent

- [ ] `SettingsSchema.toolSearch: "auto" | "on" | "off"`，缺省 `auto`，用户级与项目级合并
- [ ] 启用判定：compat 门槛、`auto` 10% 阈值（JSON 长度 / 4）、每次请求前判定、只影响新到达的候选
- [ ] 期望工具集顺序：始终可见 → 已可见 MCP → 本次新增；`ToolSearch` 出现后保留
- [ ] `ToolSearch`：`select:`、关键词打分、`+term`、`max_results` 默认 5 上限 20；`ToolControl.addTools` 加载；结果只列名字
- [ ] `ToolSearch` 只读，跳过询问、运行 hooks；发现的工具照常经 Permission Decision
- [ ] `deferred-tools` reminder：首次完整、之后增量、compaction 后补完整；不含已发现工具
- [ ] 子 Session 独立判定与已发现集
- [ ] Agent Core e2e 覆盖 spec Testing Decisions 全部条目
