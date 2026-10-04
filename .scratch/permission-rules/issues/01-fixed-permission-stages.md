# 01: 权限判定拆成固定阶段

**What to build:** 不改任何行为，把 session 里的 `beforeToolCall` 权限逻辑移进 permissions 模块，由一个入口按固定顺序调用具名阶段：规则（本工单为空，永远无意见）→ Permission Mode（含 Permission Review 的批量预启动）→ 交互。每个阶段返回 `allow | deny(reason) | ask(reason) | 无意见`，合成语义按 spec 的「固定阶段」一节实现。后续工单只需往规则阶段里填内容。

**Blocked by:** None (can start immediately)

**Status:** in-progress

参考：[spec](../spec.md)「固定阶段（地基 C 的本轮落地）」。

- [x] 权限判定入口与各阶段位于 permissions 模块，session 只负责接线
- [x] 阶段合成语义已实现：规则 deny → 拒绝；规则 ask → 跳过模式阶段直接交互；规则 allow → 跳过模式阶段；无意见 → 模式阶段给默认值
- [x] 现有 permissions、permission-review、questions、todo 等 e2e 测试不改断言，全部通过
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

- 2026-10-04：实现与验证完成，Standards / Spec 双轴审查待执行。`createPermissionGate` 在 permissions 模块拥有具名规则、模式和交互阶段、review 批量预启动以及收尾；session 只接线。规则阶段按本工单恒无意见，保留现有 `allowTools`、拒绝文案和事件行为，不提前实现规则匹配或会话放行。
- 公共测试接缝：`createSession` + faux model；新增同一 Turn 中回答 review 时切换模式的行为覆盖，既有四组 e2e 的断言未改。focused 验收为 86 pass / 0 fail；`rtk proxy bunx tsc -b` exit 0；`rtk proxy env -u NO_COLOR bun run check` exit 0，764 pass / 0 fail，63 files（含格式、lint、类型与 knip 检查）。本工单为行为不变的重构，先运行既有测试和新增行为特征测试确认基线，再迁移实现。
