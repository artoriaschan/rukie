# 02: Tool Search 核心

**What to build:** `toolSearch` 设置、启用判定、Deferred Tool 期望工具集、`ToolSearch` 工具和 `deferred-tools` reminder。启用时 MCP 工具（除 `authenticate`）作为 Deferred Tool，模型经 `ToolSearch` 加载后在对话中保持可调用；已发现集从 Transcript 推导，resume / compaction / rewind / 子 Session 行为照 spec。详见 [Tool Search spec](../spec.md) 的 Implementation Decisions 与 Testing Decisions。

Blocked by: 01

Status: resolved

- [x] `SettingsSchema.toolSearch: "auto" | "on" | "off"`，缺省 `auto`，用户级与项目级合并
- [x] 启用判定：compat 门槛、`auto` 10% 阈值（JSON 长度 / 4）、每次请求前判定、只影响新到达的候选
- [x] 期望工具集顺序：始终可见 → 已可见 MCP → 本次新增；`ToolSearch` 出现后保留
- [x] `ToolSearch`：`select:`、关键词打分、`+term`、`max_results` 默认 5 上限 20；`ToolControl.addTools` 加载；结果只列名字
- [x] `ToolSearch` 只读，跳过询问、运行 hooks；发现的工具照常经 Permission Decision
- [x] `deferred-tools` reminder：首次完整、之后增量、compaction 后补完整；不含已发现工具
- [x] 子 Session 独立判定与已发现集
- [x] Agent Core e2e 覆盖 spec Testing Decisions 全部条目

## Comments

- 2026-10-08：在 `codex/tool-search-02`（基于集成分支 `6a23d44a`）交付核心能力。`tools/tool-search/` 拥有兼容门槛、阈值、保留顺序规划、查询与名单增量；Session 仅协调 registry、原生 offered tools、Transcript、授权及子对话。完整 MCP executable registry 保留，模型初始工具集过滤 Deferred Tool，命中通过原生 `ToolControl.addTools` 加载。
- TDD：首例 Headless 请求先失败（缺失 ToolSearch、echo 提前暴露 schema），再通过；显式子类型 allowlist 首次失败暴露类型发现目录缺少 ToolSearch，补入完整目录后通过；真实原生 Compaction 场景先失败（新 head 尚无 schema baseline，下一次 rebuild 错误丢失发现集），改为仅在投影没有 system baseline 时从选中分支完整 Transcript 重建，再通过。未增加发现集 Tool State。
- 通过 `createSession`、fake model 与真实 MCP fixtures 验证：auto 在恰好 10% 与额外 1 个声明字符的边界、on/off、两类 compat、未知 settings 值及非可信项目覆盖；select/关键词/名字权重/+term/default5/max20/invalid21/未知名字/无匹配/已可用；模型投影及实际 main.jsonl 的原生追加 delta；晚到/开关变化/已可见不收回/移除重现；resume/rewind/真实 Compaction；普通、fork、retained child 独立发现与 allowlist；OAuth authenticate 不延迟、正常执行授权 deny、正常 hooks、取消 preflight、不提供 Interaction 的 Headless。
- 工具顺序澄清：已有存活声明的位置优先于新出现的始终可见工具；晚出现的 ToolSearch 追加到存活声明之后。同名声明变化移除并追加该声明，MCP 目录重新排序本身不移动已可见声明。这覆盖 01 的中间实现顺序预期，不改变原生差异提交。
- 验证：`env -u NO_COLOR bun test packages/agent/tests/e2e/tool-search.test.ts packages/agent/tests/e2e/tool-search-children.test.ts packages/agent/tests/e2e/mcp.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/reminders.test.ts packages/agent/tests/e2e/compaction.test.ts packages/agent/tests/e2e/checkpoint.test.ts packages/agent/tests/e2e/subagents.test.ts packages/agent/tests/e2e/subagent-fork.test.ts packages/agent/tests/e2e/subagent-permissions.test.ts packages/agent/tests/config packages/agent/tests/permissions`：362 pass、0 fail、1271 assertions，12.69s。新增场景均低于 300ms，使用原生 idle/request settlement、真实 MCP 进程结束、受控 HTTP preflight 完成信号，无固定等待。
- `bun run check:dev`、`oxfmt`、`oxlint`、`tsc -b`、`knip` 通过；最终 aggregate 由集成分支执行一次。
- ADR coverage：沿用 spec 的 ADR-0025（客户端检索、Transcript 发现集）、ADR-0024（原生 ToolControl、Compaction baseline）、ADR-0016（模型可见事实可重建）。增量 reminder 只从持久化来源文本重建名单，不增加额外持久化状态；查询和设置为局部行为，无需新增 ADR。
