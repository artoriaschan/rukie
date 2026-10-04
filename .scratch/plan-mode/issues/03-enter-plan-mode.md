# 03: `enter_plan_mode`

**What to build:** 模型可以用 `enter_plan_mode` 申请进入 Plan Mode。

- 走正常审批：`ask` 和 `auto-review` 下都直接问用户（不交给 reviewer 自动批准），`full-access` 下自动放行。用户批准后 Plan Mode 打开，从下一次模型调用起注入 plan reminder；拒绝时返回失败的工具结果。
- 已在 Plan Mode 时调用报错。
- 子代理工具集里没有它；Headless CLI 也没有它。
- TUI 用通用审批框和通用工具卡。

**Blocked by:** 01

**Status:** resolved

- [x] e2e：`ask` 下调用触发审批，批准后 `planMode` 为 true，下一次模型调用有 plan reminder
- [x] e2e：`auto-review` 下不走 reviewer，直接问用户；`full-access` 下不问直接进入
- [x] e2e：拒绝时 `planMode` 不变，工具结果为失败
- [x] e2e：已在 Plan Mode 时调用报错；子代理工具集里没有它
- [x] CLI：Headless 工具集里没有 `enter_plan_mode`
- [x] `tsc -b` 与全量 `bun test` 通过

## Answer

已实现 `enter_plan_mode` 无参数工具：批准后调用现有 Plan Mode Tool State 更新接口，下一次模型调用收到 plan reminder；已处于 Plan Mode 时返回 `already in plan mode` 错误。注册仅面向提供 `onPlanReview` 的父 session，所有子代理类型（general-purpose / explore / custom / fork）及 Headless 均不注册。

权限判定沿用既有链：Permission Rules 优先；`ask` / `auto-review` 直接调用 `onPermissionAsk`，`full-access` 模式自动允许。`auto-review` 的同批候选筛选复用同一策略，因此只对普通工具发起 reviewer，不对 `enter_plan_mode` 发起 reviewer。Permission Mode 保持原值，TUI 继续使用通用审批与工具卡。

公共接口依赖来自 issue 02 的 `b9f497226df0fc828b83b626e94ae8720f84f8e4`（`onPlanReview`），在本工作树 cherry-pick 为 `a87684414fa125b629a2a4f47d3bf40323f75041`。03 实现提交为 `5e920163289275d310cb3d06316def344c081f3a`；不重复实现 issue 02 的计划评审。

验证：

- `bun test packages/agent/tests/e2e/enter-plan-mode.test.ts apps/neant-cli/tests/plan-mode.test.ts`：19 pass，0 fail；覆盖批准、拒绝、三种 Permission Mode、显式规则优先级、同批 reviewer 筛选、重复进入、全部子代理类型、Headless 工具集及取消后丢弃延迟批准。
- `bunx tsc -b`：exit 0。
- 临时隔离 `HOME` 并移除 `NO_COLOR` 后执行 `bun run check`：格式、lint、类型、knip 与全量测试均通过，exit 0；1141 pass，0 fail，6243 assertions，87 files，123.91s。日志 `/tmp/neant-plan-mode-03-check.log`。
- `/code-review` 以 `a87684414fa125b629a2a4f47d3bf40323f75041` 为基点，两轴并行审查：Standards 0 findings，Spec 0 findings。Standards reviewer 独立复跑专项测试：19 pass，0 fail。
