# 05: MCP 面板整体验收与文档

**What to build:** 验证完成接线后的跨概念行为，补齐公开回归与使用说明，交付可审查且状态准确的完整功能。详见 [spec](../spec.md) 的 Testing Decisions。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] 公开 Core/TUI 组合回归验证实际状态事件、同一 Run 授权/失效与工具浏览更新、Interaction 暂停/恢复、管理结果与选择消失退回，包含相关微任务排序。
- [ ] zh/en、40×12、resize、小于下限暂停/恢复、鼠标/键盘/长 schema 与 Todo/Subagent/Goal 共存不溢出，阅读锚点与焦点稳定。
- [ ] 主输入锁覆盖普通字符、Enter、历史、Tab 补全、文本/图片粘贴、开启前在途 clipboard/image 结果；OAuth 自定义输入保持可用，关闭后主输入恢复。
- [ ] 关闭、Resume、换 Session、取消和退出无面板持久化、Transcript 注入、晚到更新、残留订阅/回调或终端模式。保留 Headless、普通问题、审批与其他 picker 的行为。
- [ ] 更新 [MCP 文档](../../../docs/mcp.md)与 [TUI README](../../../apps/neant-tui/README.md)，写明四层导航、输入锁、按键/鼠标、busy、实时快照与回退；公开 Core API/事件契约在其源码 JSDoc 与文档一致。
- [ ] 临时 HOME、unset NO_COLOR 下运行完整 `bun run check`，记录实际命令、退出结果、测试数与限制；检查文档格式、引用及diff。
- [ ] 提交最终集成 diff、验证记录与固定基线，供集成流程在所有票完成后进行 Standards/Spec 两轴审查；所有票状态与证据符合交付。原 MCP OAuth08真实账户待办保持独立，不能用本票模拟验收关闭。

## Context pointers

- [完整 spec](../spec.md)、[已确认访谈](../interview.md)。
- [question parity tests](../../../apps/neant-tui/tests/e2e/question-panel-parity.test.ts)、[permissions tests](../../../apps/neant-tui/tests/e2e/permissions.test.ts)、[OAuth manual acceptance](../../mcp-oauth/issues/08-tui-mcp-command.md)。

## Comments

2026-10-06：设计已确认，尚未实施。本票补齐跨概念场景而非重复前三层已有断言；仅记录当前运行过的验证，不预填通过证据。
