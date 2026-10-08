Status: resolved

# Spec: Tool Search

本文件记录首次交付的规范；原生能力启用门槛及固定顶层工具列表的要求已由 [ADR-0026](../../docs/adr/0026-protocol-independent-tool-search.md) 替代，当前行为见 [MCP Tool Search](../../docs/mcp.md#tool-search)。

术语见 `CONTEXT.md` 的 Tool、MCP Server、Deferred Tool、Tool Search、Transcript、Compaction、Rewind。架构决定见 [ADR-0025](../../docs/adr/0025-client-side-tool-search.md)。参考：Claude Code `ToolSearch`（`select:` 与关键词查询语法）。

## Problem Statement

接了几个 MCP server 之后，几十上百个工具定义每轮都随请求发送，占掉上下文窗口的一大块，输入成本随之上涨；工具一多，模型也更容易选错。大多数 MCP 工具在一次对话里根本用不到。

## Solution

MCP 工具定义的估算 token 超过模型上下文窗口 10% 时（或用户设置 `toolSearch: "on"`），MCP 工具成为 Deferred Tool：模型只经 reminder 看到它们的名字，需要时调用 `ToolSearch` 按名字或关键词找到并加载，之后该工具在对话中保持可调用。加载经 pi 原生的对话中工具变更完成，前缀缓存不受影响。模型不支持对话中工具变更时不启用。

## User Stories

1. 作为用户，我想接了很多 MCP 工具时上下文不被工具定义占满，这样长任务能做得更久、更便宜。
2. 作为用户，我想 MCP 工具少的时候一切照旧，这样不必多付一次搜索往返。
3. 作为用户，我想在 settings.json 用 `toolSearch` 设为 `auto` / `on` / `off`，这样能强制开启或关闭。
4. 作为用户，我想项目级 settings 能覆盖用户级的 `toolSearch`，这样不同项目各自取舍。
5. 作为用户，我想模型找到一个 MCP 工具后在本对话后续轮次直接可用，这样不用反复搜索。
6. 作为用户，我想 resume、compaction 后已找到的工具仍然可用，rewind 后回到当时的状态。
7. 作为用户，我想 Tool Search 不破坏 prompt 缓存，这样省下的 token 不会被缓存失效吃掉。
8. 作为用户，我想 MCP OAuth 的 `authenticate` 工具始终可见，这样模型总能发起授权。
9. 作为用户，我想经 Tool Search 找到的工具照常走权限判定，这样搜索不绕过授权。
10. 作为 Headless 用户，我想 Tool Search 与 TUI 行为一致，因为它不需要 Interaction。
11. 作为用户，我想子代理有自己的已发现集，这样子对话的模型输入只由它自己的 transcript 决定。

## Implementation Decisions

### 设置

- `SettingsSchema` 增加 `toolSearch?: "auto" | "on" | "off"`，缺省 `auto`；用户级与项目级都可设，合并沿用现有平铺字段规则。不受 Trusted Project 约束（只影响 token 用量）。
- 不提供阈值或按 server 配置。

### 启用判定

- 候选集合：当前允许的 MCP 工具，排除 `authenticate`。
- 当前允许的工具目录必须注册 `ToolSearch` 才能启用；子类型工具白名单未允许 `ToolSearch` 时，即使设置为 `on`，其允许的 MCP 工具也直接可见，不生成 Deferred Tool reminder，不扩大白名单或执行权限。
- 模型 compat 无 `supportsMidConvoToolChanges` 且无 `supportsToolSearch` 时：一律不启用（含 `on`）。
- `off`：不启用；`on`：有候选即启用；`auto`：候选定义估算 token（声明 JSON 长度 / 4）> `contextWindow × 10%` 时启用。
- 每次请求前重新判定。判定只决定**新到达**的候选是否延迟；已在对话中可见的 MCP 工具不收回。启用后才出现、并且判定为启用的候选成为 Deferred Tool；判定为不启用时新到达的候选直接可见。
- 启用期间 `ToolSearch` 工具加入始终可见工具；对话中一旦出现过 `ToolSearch`，之后保留（避免移除改写）。

### 已发现集与工具顺序

- 已发现集从当前对话的 Transcript 推导：当前对话可见工具（`getCurrentTools`）中的 MCP 工具即为已可见集合；不另存 Tool State。
- 初始期望工具集顺序：始终可见工具 → 本次新可见的 MCP 工具。后续请求优先保留所有仍有效声明的 Transcript 位置，再追加本次新可见工具；已有 MCP 声明按对话出现顺序保留，晚出现的 `ToolSearch` 追加在它们之后。同名声明变化移除后追加该声明；MCP 目录重新排序不移动已可见声明。必须满足 pi-durable `planTools` 的"保留原位 + 追加"条件，否则会整表移除重加。
- Session 的 loadout 同步（`session/index.ts` `beforeRequest` 中 `rukie.mcp-loadout`）改为只写差异：移除不再存在的工具、追加新工具；不再整表移除重加。
- MCP server 移除某工具：从可见集移除；重新出现时按当前判定决定是否延迟。
- Compaction：pi-durable 在新 head 后写完整基线，基线取当前期望工具集，已发现工具因此保留。
- Rewind：已发现集随选中分支的 Transcript 回退。
- 子 Session：独立判定，已发现集从其自身 Transcript 开始，不继承父级。

### `ToolSearch` 工具

- 输入：`query: string`，`max_results?: integer`（默认 5，上限 20）。
- `select:A,B`：按名字精确选取，不受 `max_results` 限制；未知名字在结果中列出。
- 其他：空白分词关键词，对名字（`mcp__server__tool` 按 `_`/`__` 切分）与描述打分，名字命中权重高于描述；`+term` 要求名字包含该词。按分数取前 `max_results`。
- 命中的 Deferred Tool 经 `ToolControl.addTools` 加载；结果文本只列出已加载工具名，已可见的标注"已可用"，无匹配时说明并提示 `select:` 用法。不复述 schema。
- 只读：权限判定跳过询问（与其他只读工具一致），hooks 照常运行。
- `ToolSearch` 的 description 固定，不含 Deferred Tool 名单。

### Deferred Tool 名单 reminder

- 新 reminder source `deferred-tools`：首次给出完整名单；MCP 工具变化时只追加增量（新增 / 移除）；compaction 后在新投影中补完整名单。具体接入现有 `reminders/` 的比较与 compaction 重注入机制。
- 已发现的工具不再出现在名单中。
- Agent Core 文案为英文、面向模型，不经 i18n（ADR-0008）。

## Testing Decisions

入口：`createSession` + 现有 fake model 与 fake MCP server helper；模型 compat 通过 fake model 定义控制。

- `auto` 阈值两侧（刚好不超过 / 超过 10%），`on` / `off`，以及不支持对话中工具变更的模型忽略 `on`。
- 搜索 `select:` 与关键词（含 `+term`、`max_results` 默认与上限、无匹配）后，下一次请求的工具集包含命中工具，并且之前的工具保持原位（断言 transcript 中工具变更只追加，无整表移除）。
- MCP 工具晚到：首次请求无 MCP 工具，之后到达超阈值的工具成为 Deferred；已可见工具不收回。
- MCP 移除已发现工具；重新出现时回到 Deferred。
- resume 后已发现集一致；compaction 后已发现工具仍可见、名单 reminder 补完整；rewind 到发现前回到 Deferred。
- 子 Session 独立已发现集；白名单不含 `ToolSearch` 时允许的 MCP 工具直接可见、无 Deferred Tool reminder，实际调用仍受 deny 规则约束。
- `authenticate` 始终可见；发现后的工具仍经权限判定（deny 规则生效）。
- Headless：无 Interaction 回调时 `ToolSearch` 可用。
- 设置解析：非法 `toolSearch` 值被拒绝；项目级覆盖用户级。

## Out of Scope

- Anthropic 服务端 tool search（见 ADR-0025）。
- 内置工具延迟加载、按 MCP server 配置、可配置阈值。
- 语义 / embedding 检索、BM25 依赖。
- TUI 专用的 `ToolSearch` 工具卡（沿用通用工具展示；如需定制另开票）。

## ADR Coverage

| 决定或修改                                        | 归属                                                                                                                                       | 理由                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 客户端 Tool Search，经 pi 原生工具变更加载        | 新增 [ADR-0025](../../docs/adr/0025-client-side-tool-search.md)                                                                            | 放弃服务端方案的长期取舍              |
| 不支持对话中工具变更的模型不启用                  | 新增 [ADR-0025](../../docs/adr/0025-client-side-tool-search.md)                                                                            | 前缀缓存约束                          |
| 已发现集只从 Transcript 推导                      | 新增 [ADR-0025](../../docs/adr/0025-client-side-tool-search.md)；沿用 [ADR-0016](../../docs/adr/0016-tool-state-and-context-projection.md) | 模型可见输入可重建，不另立 Tool State |
| 构建于 pi-durable `ToolControl` 与 pi-ai 工具变更 | 沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)                                                                           | 复用锁定 harness API                  |
| `toolSearch` 设置字段                             | 无需 ADR                                                                                                                                   | 普通用户偏好字段，不涉及信任或凭据    |
| `ToolSearch` 查询语法与默认数量                   | 无需 ADR                                                                                                                                   | 局部工具行为，可随时调整              |

## Delivery ADR Review

2026-10-08：对照 01/02 实现、03 文档与 ADR Coverage，确认模块所有权、完整 registry 与 offered loadout 分离、原生工具追加、Transcript 发现集、Compaction 无基线分支重建、Rewind 与独立子 Session 均受 ADR-0025、ADR-0024 及 ADR-0016 仍有效部分覆盖。晚出现 ToolSearch 服从存活声明保留位置，名单增量从持久化来源文本重建，不增加 Tool State。既有授权、MCP 信任与凭据、Interaction 门槛不变；设置和查询语法为局部行为，无需额外 ADR。未发现既有 ADR 冲突或遗漏的长期取舍；整体 spec 状态待集成分支最终验证和 code review 后关闭。

2026-10-08 code review 修正：启用条件要求允许目录中存在 ToolSearch，避免受限子类型只有 MCP 工具但无法搜索其定义。该条件落实既有子 Session allowlist 与授权边界，为局部启用条件，无需新增 ADR；ADR-0025 的客户端检索与 Transcript 发现集决定不变。Session 工具组合位置文档更新为 tools.ts 组装内置能力工具、index.ts 协调 MCP、ToolSearch、完整工具目录与 loadout，符合 ADR-0011 的 Session 组合职责。spec 仍等待集成分支最终验收。

## Delivery Evidence

- 2026-10-08：三个实施票在 `codex/tool-search` 集成；Settings、ToolSearch、增量 loadout/reminder、权限与 hooks、恢复与独立子 Session 的行为及使用文档一致。
- 双轴 code review：Standards 1 项（工具组合位置文档）、Spec 1 项（受限子代理没有搜索入口），均修复；ADR Coverage 与最终 diff 核对完成，无未解决发现。
- 集成分支执行一次 `env -u NO_COLOR bun run check`：静态、tracker、docs、ink boundaries 通过；测试 3096 pass、1 fail、17770 assertions，282 files，108.93s。失败是 `tool-declarations.test.ts` 的旧整表重写断言，已最小复现并改为只重定义变化的 subagent、保留其他声明位置及精确新描述。
- 修正后 `env -u NO_COLOR bun test packages/agent/tests/e2e/tool-declarations.test.ts packages/agent/tests/e2e/tool-search.test.ts packages/agent/tests/e2e/tool-search-children.test.ts`：43 pass、0 fail、129 assertions，4.70s；`bun run check:dev` 通过。最后只改测试消费者与交付文档，未改变生产代码；按根规则复用其余完整测试证据，不重复 aggregate，也不将首次失败描述为完整通过。
- 工单与 spec 在本提交同时关闭；仅清理本次创建、干净且已合入集成分支的实现 worktrees，集成分支保留供后续合并。
