# 09：交付验收与规格收尾

Status: claimed
Blocked by: 04, 08

**What to build:** 在全部功能完成后，按根规则与 [ADR Coverage 审阅](../../../docs/agents/issue-tracker.md#adr-coverage-before-delivery)完成文档收尾和本地验收，使规格可以关闭。

- [x] 修正 docs/architecture.md 中「MCP 连接属于一次 Run」的过时描述，核对 CONTEXT.md、ADR-0047、ADR-0048 与最终实现一致
- [x] 对照最终 diff 审阅 spec 的 ADR Coverage 表，修正遗漏或冲突并记录结论
- [ ] `bun run check:dev` 通过
- [ ] MCP Host 属于共享生命周期改动，本地运行一次 `env -u NO_COLOR bun run check` 并记录实际结果
- [ ] 用 `bun run dev:desktop:web --isolated` 在 Chromium 中验收插入列表、技能标记、复制粘贴、`/mcp` 状态，覆盖 Light、Dark 与窄宽度，检查控制台与网络错误并截图
- [ ] 更新各工单验证记录，关闭最后一张工单时同步把 spec 设为 resolved

## Comments

- 2026-10-16：新文档实施代理 `/root/implement_09_docs` 在 `/tmp/rukie-composer-09`、`docs/composer-ticket-09` 认领，基线 `49bc9dd1`。文档审阅使用 rukie-doc 与 domain-modeling；仅运行文档检查、改动文件格式与 diff 检查。主代理统一拥有静态、共享生命周期完整检查及 Chromium 验收；本票、其他票与 spec 保持 claimed，等待独立评审与统一验收。

- 文档与 ADR Coverage 审阅、票 01–08 有效证据索引已归档 [verification.md](../verification.md#ticket-09--文档与-adr-coverage-审阅待独立评审)。修改均为 Markdown；server README 与 ADR-0048 经核对无需改动。保留 claimed，完整检查、浏览器、新代理评审及最终关闭仍由主代理协调。

- 文档验证：`rtk proxy bun run docs:update`、`rtk proxy bun run check:docs`（157 Markdown）、9 份改动 Markdown 的 oxfmt --check 与 `rtk git diff --check` 均通过；未重复运行主代理拥有的行为／静态／浏览器验收。
