# 01: 权限判定拆成固定阶段

**What to build:** 不改任何行为，把 session 里的 `beforeToolCall` 权限逻辑移进 permissions 模块，由一个入口按固定顺序调用具名阶段：规则（本工单为空，永远无意见）→ Permission Mode（含 Permission Review 的批量预启动）→ 交互。每个阶段返回 `allow | deny(reason) | ask(reason) | 无意见`，合成语义按 spec 的「固定阶段」一节实现。后续工单只需往规则阶段里填内容。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

参考：[spec](../spec.md)「固定阶段（地基 C 的本轮落地）」。

- [ ] 权限判定入口与各阶段位于 permissions 模块，session 只负责接线
- [ ] 阶段合成语义已实现：规则 deny → 拒绝；规则 ask → 跳过模式阶段直接交互；规则 allow → 跳过模式阶段；无意见 → 模式阶段给默认值
- [ ] 现有 permissions、permission-review、questions、todo 等 e2e 测试不改断言，全部通过
- [ ] `tsc -b` 与全量 `bun test` 通过
