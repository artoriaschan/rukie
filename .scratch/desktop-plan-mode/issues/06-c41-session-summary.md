# 06：C41 会话摘要侧栏改造

Status: ready-for-agent

Blocked by: 05

**What to build:** 把现有的 `Summary` 浮层（`conversation-dock.tsx`，宽 288px）改造成 C41。几何以 rukie.pen 的 `TpG3F` 和 H20 为准；宽度与样式的改动已获用户授权。

- [ ] 宽度改为 300px，样式改为 C41 卡片：`$card` 背景，16px 圆角，卡片间距 12px，行高 32px。
- [ ] 卡片顺序为待办、子智能体、计划。没有内容的卡片不显示。
- [ ] 计划卡显示 Transcript 中最近一次 `exit_plan_mode` 的计划标题，单行，超出省略。悬停时背景变为 `$hover`。点击计划卡打开 C44（回调先留空，由 07 接入）。
- [ ] 不实现环境信息和产物展示。
- [ ] 补充中英文文案。
- [ ] DESIGN.md：新增 C41 规则。
- [ ] Chromium 测试：
  - 卡片的显示条件和顺序
  - 宽度 300px
  - 会话恢复后，计划卡能从 Transcript 重建
  - Escape 关闭侧栏
  - 窄宽度和 Light/Dark 主题
  - 布局回归：除已授权的宽度外，其余布局不变
