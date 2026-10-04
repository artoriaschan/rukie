# 01: Plan Mode 状态与用户开关

**What to build:** 用户可以打开和关闭 Plan Mode，打开后模型收到引导，先探索、再出方案。

- Agent Core：新增 Tool State `plan`（`{ active }`，默认关闭），随 transcript 持久化，resume 后保留。Session 暴露只读的 `planMode` 和 `setPlanMode(on)`，可在 run 进行中调用，从下一次模型调用起生效。
- 提示：打开时注入 plan reminder，说明先探索、计划写成 markdown、权限照常；关闭时注入一条退出提示。不改 System Prompt。
- 子代理与父 session 共用同一个 Plan Mode 状态。
- TUI：`/plan` 打开，`/plan <指令>` 打开并发送指令，`/plan off` 关闭；已在 Plan Mode 时再输入 `/plan` 只提示。Plan Mode 下输入框边框换成 plan 色，StatusLine 显示 `plan` chip。新文案走 i18n，zh / en 齐全。

**Blocked by:** None (can start immediately)

**Status:** claimed

- [ ] e2e：`setPlanMode(true)` 后下一次模型调用的上下文里有 plan reminder；关闭后有一条退出提示，之后不再注入
- [ ] e2e：run 进行中调用 `setPlanMode`，从下一次模型调用起生效；重复调用不重复发事件
- [ ] e2e：状态变化发 `tool_state_changed`；resume 后 `planMode` 保留，reminder 照常注入
- [ ] e2e：Plan Mode 下工具权限照常判定，没有额外 deny
- [ ] e2e：子代理在父处于 Plan Mode 时也收到 plan reminder
- [ ] TUI e2e：`/plan`、`/plan <指令>`、`/plan off` 的行为；边框颜色与 `plan` chip 随状态切换
- [ ] `tsc -b` 与全量 `bun test` 通过
