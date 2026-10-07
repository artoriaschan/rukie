# 09: 状态行：上下文占用

Status: wontfix

**What to build:** 需要的 Agent Core 支持：`session_start` 或 usage 附带 `contextWindow`。工作状态行的用法：前缀 `⚠ 上下文NN%`，≥80% 用 warning，≥95% 用 error。参考 dsh-working-activity 的对应实现，见 `.scratch/working-activity/spec.md` 的 Out of Scope 表。

Blocked by: 03

## Comments

- 2026-10-02：已并入 `.scratch/status-line/`（spec 中 ③ `ActivityLine` 一节，工单 03 和 05）。
