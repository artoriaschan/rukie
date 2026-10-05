# 01: 放行后阶段（prefactor）

**What to build:** 在地基 C 的判定链里补上只读的放行后阶段：工具调用被判定为 allow 之后、执行之前调用一次，拿到 hook 改写后的最终参数。它不能改判、不能改参数；被拒、被 hook 阻断或参数无效的调用都不会到达这里。本工单不挂任何使用方，现有行为不变，为 Checkpoint 预留接入点。见 [spec](../spec.md)。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Agent Core 内部可注册一个放行后回调，按 hooks → 规则 → Permission Mode → 交互 → 放行后 → 执行 的顺序调用
- [x] 回调收到工具名与改写后参数（含 `updatedInput` 生效后的参数）
- [x] deny（规则 / 用户 / review / hook）时不调用
- [x] 回调抛错时工具调用失败并以错误结果返回，不执行工具
- [x] 子代理的工具调用同样经过（按引用共享父配置）
- [x] e2e 测试覆盖：调用顺序、拒绝不触发、改写参数可见；现有测试全绿

## Comments

### 2026-10-05 — Delivery and verification

- Added internal `onToolCallAllowed` registration to Session and its shared permission configuration. The permission gate invokes it exactly once after final allow and before execution, with a private copy of validated final arguments. The callback cannot rewrite executed input or change permission decisions; errors become tool error results through the existing pi path. No Checkpoint consumer is attached.
- Public `createSession` e2e tests cover frontend/rule/mode/review allow, both hook rewrite paths, all deny and invalid-input paths, errors without execution, both subagent entry points, and cancellation before/while the stage runs. The initial stage-order test failed before implementation; the cancellation guard was also demonstrated by a failing test before its fix.
- `rtk proxy bun x tsc -b`: exit 0.
- `rtk proxy bun test packages/agent/tests/e2e/post-allow-stage.test.ts packages/agent/tests/e2e/hooks.test.ts packages/agent/tests/e2e/permission-hooks.test.ts packages/agent/tests/e2e/subagent-permissions.test.ts packages/agent/tests/e2e/permissions.test.ts`: 119 pass, 0 fail, 426 assertions, exit 0.
- Complete `env -u NO_COLOR bun run check` under an isolated temporary HOME with `caffeinate -is`: 1470 pass, 0 fail, 7588 assertions, 110 files, 167.72s, exit 0. Log: `/tmp/neant-checkpoint-01-check.log`. Temporary HOME removed afterwards.
- Independent code-review Standards and Spec agents reviewed `git diff 2afb59b...HEAD`. Standards: 0 documented-standard violations; one optional duplicated test routing smell was fixed and independently confirmed closed, leaving 0 findings. Spec: 0 findings, including no scope creep or missing requirements.
- After the review-only test helper cleanup, the 21 stage tests (76 assertions) and typecheck passed again, exit 0; production code was unchanged from the complete check.
- Integration and managed worktree cleanup belong to the parent delivery task.
