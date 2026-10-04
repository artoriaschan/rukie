# 03: `enter_plan_mode`

**What to build:** 模型可以用 `enter_plan_mode` 申请进入 Plan Mode。

- 走正常审批：`ask` 和 `auto-review` 下都直接问用户（不交给 reviewer 自动批准），`full-access` 下自动放行。用户批准后 Plan Mode 打开，从下一次模型调用起注入 plan reminder；拒绝时返回失败的工具结果。
- 已在 Plan Mode 时调用报错。
- 子代理工具集里没有它；Headless CLI 也没有它。
- TUI 用通用审批框和通用工具卡。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] e2e：`ask` 下调用触发审批，批准后 `planMode` 为 true，下一次模型调用有 plan reminder
- [ ] e2e：`auto-review` 下不走 reviewer，直接问用户；`full-access` 下不问直接进入
- [ ] e2e：拒绝时 `planMode` 不变，工具结果为失败
- [ ] e2e：已在 Plan Mode 时调用报错；子代理工具集里没有它
- [ ] CLI：Headless 工具集里没有 `enter_plan_mode`
- [ ] `tsc -b` 与全量 `bun test` 通过
