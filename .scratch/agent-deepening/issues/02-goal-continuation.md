# 02: Goal 续跑归 tools/goal

**What to build:** 激活校验、driver 任务创建与中止、轮次计数、wrap-up 与激活清理移入 `tools/goal`；Session 在 `rukie.session` hook 的固定位置调用 Goal 接口并提供 submit/settle adapter。详见 [spec](../spec.md)。

Blocked by: 01

Status: resolved

- [x] Session 不再直接读写 `GoalActivationDoc` 或解析轮次
- [x] `tests/tools/goal/` 在假 harness 上覆盖轮次、wrap-up 与撤销
- [x] goal、goal-tools、goal-recovery e2e 保留代表性用例并通过

## Comments

- 实现：`packages/agent/src/tools/goal/runtime.ts` 拥有恢复激活校验、driver 组装/创建/撤销、Goal snapshot 与 Ledger causal bind 的原子提交、已放置轮次计数、wrap-up 上下文/续跑事实、激活清理和 committed armed 投影。Session 仅提供 submit/settle adapter 并在既有 `rukie.session` hook 位置按序调用；不再读写 `GoalActivationDoc` 或解析轮次。Goal extension 仅注册 task。
- TDD：runtime seam 缺失时测试红灯；引入 `yieldWrapup` 的 provenance 用例先红后绿。module 使用 MemoryStorage + fake-model native Harness，直接验证重复计数、跳轮拒绝、上限、撤销、恢复身份校验、wrap-up 单次消费和清理后 Request 身份保留。
- 覆盖迁移：首轮放置前暂停的等价 e2e 移至 module；queued 撤销矩阵在 module 通过 submit adapter admission gate 明确控制“driver 已检查 idle → Human Run 开始 → Goal submission queued → 撤销”的顺序。保留 Session queued-pause 冒烟验证 adapter 接线、Human answer 保留和轮次不消费；Goal 工具授权、Stop hook/Subagent 优先级、崩溃 worker 和进程恢复仍保留 e2e。
- 性能：原三组 Goal e2e baseline 61 pass / 4.73s；ticket01 后三组 60 pass / 4.08s。本票最终 module + 三组 e2e 67 pass / 3.71s（module 10 项单跑 83ms；新增单项均低于 12ms）。
- 调试证据：与静态检查同时执行的 focused run 曾在旧 clear queued e2e 等待 queued 信号处超时（5s）；最小 clear reproducer 81ms 通过。源码表明旧 test 在 driver phase2 commit 触发 steer，然后依赖 admission 调度竞争：driver 若先观察到 Human Live 会等待 Human answer，而 test 又等待 queued。等价 clear/resume 矩阵迁入显式 gate，未扩大超时或加入固定 sleep。
- 验证：`env -u NO_COLOR bun test packages/agent/tests/tools/goal/runtime.test.ts packages/agent/tests/e2e/goal.test.ts packages/agent/tests/e2e/goal-tools.test.ts packages/agent/tests/e2e/goal-recovery.test.ts`，67 pass / 0 fail；`bun run check:dev` 通过；`git diff --check` 通过。完整 `check` 由 integration branch 在全部票集成后执行。
- ADR 覆盖：沿用 spec 的 ADR-0011/0024/0028；Goal 不反向依赖 Session，原生 Generation hook 仍只由 Session 注册，Request 编码与持久化执行语义保持不变。
