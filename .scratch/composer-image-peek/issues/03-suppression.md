# 03: 不显示预览的情况

**What to build:** 在会被预览遮挡或冲突的界面状态下，光标停在 token 上也不显示预览；模态预览打开时只显示模态预览。条件与消息区预览入口的拦截条件一致，另加小终端。

**Blocked by:** 01: 光标停在 token 上显示预览

**Status:** resolved

- [x] 小终端（`columns < 40 || rows < 12`）不显示；resize 回正常尺寸后光标仍在 token 上即显示
- [x] 待处理审批或提问交互时不显示，交互结束后恢复
- [x] 非 chat 视图、模型选择器或 Session 选择器打开、Rewind 中不显示
- [x] 点缩略图打开模态预览时只显示模态卡，关闭后光标预览恢复
- [x] e2e 覆盖以上行为；集成代码 `3950234` 的 `env -u NO_COLOR bun run check` 通过（2512 pass / 0 fail）

## Answer

- 模态入口、光标预览和光标预览 Esc 共用 `imagePreviewBlocked`，覆盖待处理 Interaction、非 chat、模型/Session 选择器、Rewind 与 MCP 面板；另外检查 small 和模态预览优先级。
- 小终端/非 chat 卸载 composer 后，PromptInput 从 Chat 已报告的光标位置恢复；初始回调后立即释放 cursorOffset，正常编辑与 owner reset 保持原有路径。
- app start/headless terminal e2e 覆盖审批恢复、提问展开/折叠时隐藏、Esc 正常拒答后恢复、39列与11行阈值 resize 恢复、Ctrl+A Dashboard 返回恢复、模态优先与关闭恢复、模型/Session/Rewind 面板入口。Slash Command 提交会清空草稿，关闭此类面板后验证空 composer，故不要求恢复已提交的 token。
- Red：审批出现后预览仍遮盖审批面板；small resize 后 caret 重置到 draft 末尾，预览无法恢复。修复后通过。
- 验证：`env -u NO_COLOR bun test ./apps/neant-tui/tests/e2e/composer-image-suppression.test.ts ./apps/neant-tui/tests/e2e/composer-image-dismiss.test.ts` 9 pass / 0 fail，2.07s，各用例 177–259ms；此前 peek + suppression + image-preview 22 pass / 0 fail，4.21s。`bun run check:dev` 通过；最终聚合 gate 由主 integration 执行。
- ancestry：基于 `da2c40c`，完成前已合并 integration `aefd8bc`（含 Ticket02）。

## Final verification

2026-10-07：集成代码 `3950234` 执行 `env -u NO_COLOR bun run check` 通过，2512 pass / 0 fail，184 files，测试阶段 74.47s。此前票据中的“待最终门禁”已完成；审查发现和修复见 [验收记录](../review.md)。
