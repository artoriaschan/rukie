# 01: 放行后阶段（prefactor）

**What to build:** 在地基 C 的判定链里补上只读的放行后阶段：工具调用被判定为 allow 之后、执行之前调用一次，拿到 hook 改写后的最终参数。它不能改判、不能改参数；被拒、被 hook 阻断或参数无效的调用都不会到达这里。本工单不挂任何使用方，现有行为不变，为 Checkpoint 预留接入点。见 [spec](../spec.md)。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Agent Core 内部可注册一个放行后回调，按 hooks → 规则 → Permission Mode → 交互 → 放行后 → 执行 的顺序调用
- [ ] 回调收到工具名与改写后参数（含 `updatedInput` 生效后的参数）
- [ ] deny（规则 / 用户 / review / hook）时不调用
- [ ] 回调抛错时工具调用失败并以错误结果返回，不执行工具
- [ ] 子代理的工具调用同样经过（按引用共享父配置）
- [ ] e2e 测试覆盖：调用顺序、拒绝不触发、改写参数可见；现有测试全绿
