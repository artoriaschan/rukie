# 05: 状态行：retry 事件

Status: needs-triage

**What to build:** 需要的 Agent Core 支持：Agent Core 发出模型请求重试开始和结束事件（含原因，例如限流）。工作状态行的用法：卡住原因 `被限流了，缓缓再试`，优先于文案池。参考 dsh-working-activity 的对应实现，见 `.scratch/working-activity/spec.md` 的 Out of Scope 表。

Blocked by: 03
