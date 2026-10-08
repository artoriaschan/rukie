# 01: loadout 同步只写差异

**What to build:** Session 每次请求前的 loadout 同步（`rukie.mcp-loadout`）在可见工具与期望工具不一致时，只移除不再需要的工具并追加新工具，保留已可见工具的位置；只有顺序无法通过"保留 + 追加"得到时才整表替换。这是 Tool Search 保留已发现工具、且不重复写入 schema 的前提。详见 [Tool Search spec](../spec.md) 的"已发现集与工具顺序"。

Blocked by: None (can start immediately)

Status: resolved

- [x] MCP server 增加 / 移除工具时，transcript 中的工具变更只包含差异
- [x] 已可见工具定义变化时按同名重定义处理（移除再追加该工具）
- [x] 现有 MCP drift、resume、compaction 用例保持通过
- [x] Agent Core e2e：断言 MCP 工具增删后的 `toolsRemoved` / `toolsAdded` 只含差异

## Comments

- 2026-10-08：按 Session `createSession`、fake model 与真实 stdio MCP fixture 的已确认 seam 完成 TDD。两个 Goal rounds 间更新 MCP 配置，在下一轮的 `beforeRequest` 触发 late refresh；修复前 transcript 错误移除、重加所有内置与保留的 MCP 工具，修复后只移除 `mcp__local__echo`、追加 `mcp__local__added`。
- 同名末尾定义变化只移除、重加该工具；同名首部定义变化或显式顺序调整无法经保留与追加得到期望顺序时整表替换，与锁定 pi-durable 的 `planTools` 一致。OAuth 认证工具切换也只记录实际差异。
- 验证：`env -u NO_COLOR bun test --parallel=4 packages/agent/tests/e2e/mcp.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/tool-declarations.test.ts packages/agent/tests/e2e/compaction.test.ts packages/agent/tests/e2e/compaction-hooks.test.ts`，90 pass、0 fail、515 assertions，2.86s。新增四例约 100–135ms，无固定等待；等待 Goal idle 和 MCP 进程结束完成清理。
- `bun run check:dev` 与 `git diff --check` 通过。完整 aggregate 留给集成分支最终运行一次。
- ADR coverage：沿用 spec 的 ADR-0025（增量 loadout 与前缀缓存）及 ADR-0024（复用 harness 工具变更规则），未引入额外所有权、持久化或协议取舍。
