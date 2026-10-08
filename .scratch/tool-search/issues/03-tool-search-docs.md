# 03: Tool Search 文档

**What to build:** 在 `docs/mcp.md` 说明 Deferred Tool、`toolSearch` 设置与启用条件；在 `docs/architecture.md` 的工具组装处说明 `ToolSearch` 与 loadout 同步的关系。确认 `CONTEXT.md` 词条与实现一致。详见 [Tool Search spec](../spec.md)。

Blocked by: 02

Status: resolved

- [x] `docs/mcp.md`：`toolSearch` 三种取值、10% 阈值、compat 门槛、`authenticate` 例外
- [x] `docs/architecture.md`：工具组装与增量 loadout
- [x] `bun run check:docs` 通过

## Comments

- 2026-10-08：在 `codex/tool-search-03`（基于集成分支 `9add1a19`）核对 02 源码与测试证据后更新 `docs/mcp.md`、`docs/architecture.md`、`CONTEXT.md`。记录 settings 文件来源与非可信项目覆盖、精确 compat 门槛和 10% 边界、authenticate 沿用 Interaction 门槛、查询、权限、名单与恢复语义；架构说明完整 executable registry 与 offered loadout 分离、存活声明保留原位、晚出现 ToolSearch 追加、原生 Compaction 新 head 未有基线时从选中分支完整 Transcript 重建。
- 验证：`bun run docs:update` 与 `bun run check:docs` 通过（47 Markdown files）；修改文件 `bunx --no -- oxfmt --check`、`git diff --check` 通过。文档变更按根规则不执行代码测试；最终 aggregate 与 code review 由集成分支统一执行，spec 保持开放直到整体验收。
- ADR coverage 交付审阅：客户端检索与 Transcript 唯一发现事实沿用 ADR-0025；原生工具差异提交、Compaction 工具基线和 lifecycle 沿用 ADR-0024；当前上下文投影与完整 Transcript 的区分沿用 ADR-0016 的仍有效部分。保留声明位置和无基线时完整分支重建是上述决定的实现约束，没有第二套持久化状态或 harness；权限、信任、凭据与 Interaction 门槛不改变。配置值与查询细节为局部能力行为，无需新增 ADR；spec 覆盖表与最终实现一致，无冲突或遗漏。

- 2026-10-08：文档实施已完成；票据保留 claimed 至集成审查和完整验证结束，与 spec 在同一交付提交关闭。

- 2026-10-08：集成审查与验证收尾完成，03 与 spec 同时 resolved。完整检查的实际失败、旧断言修正及聚焦通过证据见 [spec Delivery Evidence](../spec.md#delivery-evidence) 与 [review](../review.md)，没有未解决实现问题。
