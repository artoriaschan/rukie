# 04: TUI 的 auto-review 交互

Status: ready-for-agent

**What to build:** TUI 在 `auto-review` 下：评审进行时 ActivityLine 显示 REVIEW 文案；评审转来的审批对话框以评审理由为标题，只提供"允许一次"和"拒绝"。见 spec Implementation Decisions 的 TUI 节。

**Blocked by:** 02, 03

- [ ] `mode === "auto-review"` 的审批请求，对话框只有"允许一次 / 拒绝"两项
- [ ] 请求带 `reason` 时作为对话框标题
- [ ] `ask` 模式对话框保持现有三项不变
- [ ] ActivityLine 新增 review 状态与 REVIEW 文案池，由 `permission_review` start/end 驱动
- [ ] chat screen 测试覆盖以上行为
