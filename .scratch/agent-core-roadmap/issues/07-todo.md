# 07: todo 工具

Type: grilling
Status: open
Blocked by: 02

## Question

模型维护的任务清单怎么设计？与 Goal 独立（deepseek-harness 中两者解耦，仅 TUI 面板合并展示）。

需定：工具 schema（整表覆盖写 vs 增删改）；条目状态集合；配套 reminder（何时提醒模型更新、频率，复用现有 reminders 机制）；按地基 B 的持久化与 compaction 后恢复；TUI 呈现位置（与 Goal 是否共用面板）；Headless CLI 输出。
