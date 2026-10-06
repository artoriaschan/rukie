# 10: smooth reveal

**What to build:** 工具调用的 pending call view（如待写入的 diff）逐行平滑出现，而结果和回放内容立即完整显示。见 [spec](../spec.md) 的「渲染组件」。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] 共享调度器约 30 fps，每 tick 推进 `max(3, ceil(backlog / 8))` 行
- [ ] 只作用于 pending call view；result view、错误、已展开、resume / replay 卡片不启用
- [ ] 测试用可注入时钟或显式 tick 推进，不靠时间猜测
