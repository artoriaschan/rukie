# 02: Esc 关闭当前预览

**What to build:** 光标预览显示时，用户按 Esc 只关掉当前这张卡，不触发 Esc 的其他行为（如中止 Run）。光标离开该 token 再回来，卡重新出现；关闭一张不影响其他 token。

Blocked by: 01: 光标停在 token 上显示预览

Status: resolved

- [x] 预览显示时 Esc 关卡，按键被消费
- [x] Run 进行中按 Esc 关卡，Run 不中止（fake model `signal.aborted` 为 false），第二次 Esc 才走原有 Esc 链
- [x] 关闭后光标留在原 token，卡不再出现；光标离开再回来，卡重新出现
- [x] 关闭一张后移到另一个 token，那张照常显示
- [x] e2e 覆盖以上行为；集成代码 `3950234` 的 `env -u NO_COLOR bun run check` 通过（2512 pass / 0 fail）

## Answer

Chat 优先消费当前显示光标预览的 Esc，以 token 文本和起始位置记录关闭状态；离开清除状态。第一下 Esc 保留草稿且不取消进行中的 Run，第二下进入原有中断链。

实施依据：集成基线 `da2c40c` 的独立分支 `codex/composer-image-peek-02`。新增 app start/headless terminal e2e 覆盖关闭后 resize 不重开、同一 stdin chunk 的右移/左移后重开、另一 token 正常出卡、Home/Esc 同 chunk 保留草稿，以及 fake-model AbortSignal 首次未中断、第二次中断。

验证：原实现首次 Esc 会清空草稿，新增用例首先失败；实现后 `env -u NO_COLOR bun test apps/neant-tui/tests/e2e/composer-image-dismiss.test.ts apps/neant-tui/tests/e2e/composer-image-peek.test.ts apps/neant-tui/tests/e2e/image-tokens.test.ts`：17 pass，0 fail，3.06s；两条新增测试 253ms/208ms。`bun run check:dev` 通过。全量 `env -u NO_COLOR bun run check` 留给最终 integration 单次 gate。

合并注意：ticket03 的 `imagePreviewBlocked()` 需同时用于派生预览与最前面的 Esc 分支，保证被隐藏的 token 不消费 Interaction/picker/MCP/Rewind 的 Esc。

## Final verification

2026-10-07：集成代码 `3950234` 执行 `env -u NO_COLOR bun run check` 通过，2512 pass / 0 fail，184 files，测试阶段 74.47s。此前票据中的“待最终门禁”已完成；审查发现和修复见 [验收记录](../review.md)。
