# 09：交付验收与规格收尾

Status: ready-for-agent
Blocked by: 04, 08

**What to build:** 在全部功能完成后，按根规则与 [ADR Coverage 审阅](../../../docs/agents/issue-tracker.md#adr-coverage-before-delivery)完成文档收尾和本地验收，使规格可以关闭。

- [ ] 修正 docs/architecture.md 中「MCP 连接属于一次 Run」的过时描述，核对 CONTEXT.md、ADR-0047、ADR-0048 与最终实现一致
- [ ] 对照最终 diff 审阅 spec 的 ADR Coverage 表，修正遗漏或冲突并记录结论
- [ ] `bun run check:dev` 通过
- [ ] MCP Host 属于共享生命周期改动，本地运行一次 `env -u NO_COLOR bun run check` 并记录实际结果
- [ ] 用 `bun run dev:desktop:web --isolated` 在 Chromium 中验收插入列表、技能标记、复制粘贴、`/mcp` 状态，覆盖 Light、Dark 与窄宽度，检查控制台与网络错误并截图
- [ ] 更新各工单验证记录，关闭最后一张工单时同步把 spec 设为 resolved

## Comments
