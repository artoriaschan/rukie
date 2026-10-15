# 06：C41 会话摘要侧栏改造

Status: resolved

Blocked by: 05

**What to build:** 把现有的 `Summary` 浮层（`conversation-dock.tsx`，宽 288px）改造成 C41。几何以 rukie.pen 的 `TpG3F` 和 H20 为准；宽度与样式的改动已获用户授权。

- [x] 宽度改为 300px，样式改为 C41 卡片：`$card` 背景，16px 圆角，卡片间距 12px，行高 32px。
- [x] 卡片顺序为待办、子智能体、计划。没有内容的卡片不显示。
- [x] 计划卡显示 Transcript 中最近一次 `exit_plan_mode` 的计划标题，单行，超出省略。悬停时背景变为 `$hover`。点击计划卡打开 C44（回调先留空，由 07 接入）。
- [x] 不实现环境信息和产物展示。
- [x] 补充中英文文案。
- [x] DESIGN.md：新增 C41 规则。
- [x] Chromium 测试：
  - 卡片的显示条件和顺序
  - 宽度 300px
  - 会话恢复后，计划卡能从 Transcript 重建
  - Escape 关闭侧栏
  - 窄宽度和 Light/Dark 主题
  - 布局回归：除已授权的宽度外，其余布局不变

## Implementation and verification

C41 uses the installed beUI TodoList with an opt-in summary presentation; default TodoList consumers retain their existing disclosure behavior. Existing Summary subagent presentation now uses C41 rows. The transparent 300px stack contains only nonempty Tasks, Subagents and Plan cards, with 16px card corners, 12px spacing, 32px rows and source header/icon/padding geometry. The plan row receives the latest structured Transcript submission through `latestPlan`, truncates its title and passes the submission through `onOpenPlan`; App currently closes Summary, and ticket 07 connects the pane. zh/en copy and DESIGN agree with the implementation.

Public Chromium tests cover restored latest plan with reused provider call IDs, card conditions/order/source geometry, hover/cursor/focus/keyboard, Light/Dark, 300px and clamped 248px width, plan-click close, Escape, unchanged composer/workspace geometry, and the existing virtualized Transcript reading/streaming case. Focused three-case run passed; subsequent Summary-only two-case increment passed. Scoped UI types, changed-file lint/format, `docs:update`, `check:docs` and diff checks passed. The root agent owns final aggregate, package and isolated browser acceptance; this ticket ran no native acceptance. Detailed command results, logs, timings and evidence validity are in the external `ticket-06-verification.md` record supplied by the coordinator.

ADR coverage follows the spec: latest plan derives from Transcript under ADR-0016; this local presentation adds no state persistence or architectural decision. C41 geometry belongs to DESIGN, so no new ADR is required. The actual C44 entrance is intentionally completed by dependent ticket 07 before feature delivery.
