# 02: Esc 关闭当前预览

**What to build:** 光标预览显示时，用户按 Esc 只关掉当前这张卡，不触发 Esc 的其他行为（如中止 Run）。光标离开该 token 再回来，卡重新出现；关闭一张不影响其他 token。

**Blocked by:** 01: 光标停在 token 上显示预览

**Status:** ready-for-agent

- [ ] 预览显示时 Esc 关卡，按键被消费
- [ ] Run 进行中按 Esc 关卡，Run 不中止（fake model `signal.aborted` 为 false），第二次 Esc 才走原有 Esc 链
- [ ] 关闭后光标留在原 token，卡不再出现；光标离开再回来，卡重新出现
- [ ] 关闭一张后移到另一个 token，那张照常显示
- [ ] e2e 覆盖以上行为；`env -u NO_COLOR bun run check` 通过
