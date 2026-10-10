# 20: 桌面端 ADR 清单

Type: grilling

Blocked by: 18, 19

Status: needs-triage

## Question

汇总地图决策，确定要新增、修改或标记被替代的 ADR：推翻 ADR-0012 的“view 抽成 UI 包”；Effect 只在 server 内；wire 协议在 `@rukie/shared` 且单活跃连接；桌面端注册表在 Agent Core 之外；ADR-0003 的“桌面端用 SQLite”与 ADR-0024 冲突（桌面端沿用同一 JSONL store，与 TUI 互见 Session、共享单写者 lease），是否将 ADR-0003 标为被 ADR-0024 替代。每条确定标题、决策与取舍，起草放进 spec 阶段还是现在落地。
