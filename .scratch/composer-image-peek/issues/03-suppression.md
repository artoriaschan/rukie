# 03: 不显示预览的情况

**What to build:** 在会被预览遮挡或冲突的界面状态下，光标停在 token 上也不显示预览；模态预览打开时只显示模态预览。条件与消息区预览入口的拦截条件一致，另加小终端。

**Blocked by:** 01: 光标停在 token 上显示预览

**Status:** claimed

- [ ] 小终端（`columns < 40 || rows < 12`）不显示；resize 回正常尺寸后光标仍在 token 上即显示
- [ ] 待处理审批或提问交互时不显示，交互结束后恢复
- [ ] 非 chat 视图、模型选择器或 Session 选择器打开、Rewind 中不显示
- [ ] 点缩略图打开模态预览时只显示模态卡，关闭后光标预览恢复
- [ ] e2e 覆盖以上行为；`env -u NO_COLOR bun run check` 通过
