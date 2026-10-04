# 01: Plan Mode 状态与用户开关

**What to build:** 用户可以打开和关闭 Plan Mode，打开后模型收到引导，先探索、再出方案。

- Agent Core：新增 Tool State `plan`（`{ active }`，默认关闭），随 transcript 持久化，resume 后保留。Session 暴露只读的 `planMode` 和 `setPlanMode(on)`，可在 run 进行中调用，从下一次模型调用起生效。
- 提示：打开时注入 plan reminder，说明先探索、计划写成 markdown、权限照常；关闭时注入一条退出提示。不改 System Prompt。
- 子代理与父 session 共用同一个 Plan Mode 状态。
- TUI：`/plan` 打开，`/plan <指令>` 打开并发送指令，`/plan off` 关闭；已在 Plan Mode 时再输入 `/plan` 只提示。Plan Mode 下输入框边框换成 plan 色，StatusLine 显示 `plan` chip。新文案走 i18n，zh / en 齐全。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] e2e：`setPlanMode(true)` 后下一次模型调用的上下文里有 plan reminder；关闭后有一条退出提示，之后不再注入
- [x] e2e：run 进行中调用 `setPlanMode`，从下一次模型调用起生效；重复调用不重复发事件
- [x] e2e：状态变化发 `tool_state_changed`；resume 后 `planMode` 保留，reminder 照常注入
- [x] e2e：Plan Mode 下工具权限照常判定，没有额外 deny
- [x] e2e：子代理在父处于 Plan Mode 时也收到 plan reminder
- [x] TUI e2e：`/plan`、`/plan <指令>`、`/plan off` 的行为；边框颜色与 `plan` chip 随状态切换
- [x] `tsc -b` 与全量 `bun test` 通过

## Answer

已实现持久化 `plan` Tool State、只读 `session.planMode` 与 `setPlanMode(on): Promise<void>`。getter 立即更新，Promise 等待快照写入；运行中切换从下一次模型调用起生效。idle 变更的事件在下一次 Run 交给既有 `onEvent` 通道。子 session 按引用读取父状态，不单独记录 Plan Mode 快照。

新增 `plan-mode` reminder，active 内容按当前工具集选择提交工具或最终文本计划；状态不变时去重、compaction 后重发，退出提示消费一次后不再重发。不修改 System Prompt 和权限判定。TUI 完成三种 `/plan` 输入形式、重复提示、运行中切换、StatusLine chip、亮暗主题的 plan 边框色和 zh/en 文案。

## Comments

- 2026-10-04：按 implement skill 执行，在独立 `codex/plan-mode-01` worktree 中开发。TDD 使用 `createSession` + faux model 和公共终端 IO 接缝，验证运行中切换、幂等事件、resume/rewind、普通/fork 子代理共享、compaction、权限独立、命令/i18n/40/60/80 列颜色及 chip。
- 聚焦验收：`env -u NO_COLOR bun test packages/agent/tests/e2e/plan-mode.test.ts apps/neant-tui/tests/e2e/plan-mode.test.ts apps/neant-tui/tests/components/prompt-input/prompt-input.test.tsx`，20 pass / 0 fail，99 assertions（其中 19 条新增验收）。
- 最终全量验证：临时隔离 HOME、清除 NO_COLOR 的 `bun run check`，exit 0；format、lint、`tsc -b`、knip 均通过；1122 pass / 0 fail，6142 assertions，85 files，124.56s。未修改本机用户配置。
- code-review 两轴：Standards 初次发现 1 个存储失败问题，已以 public SessionStore failure/retry 测试修复写队列恢复、状态回滚和 Run store 关闭，复核后 0 项未解决；Spec 0 findings。
- 实现提交：`80b4bad`（状态与 TUI 开关）、`1e3ba8c`（公开 light palette）、`e6048f6`（存储失败恢复）。模型工具及计划评审留给 02/03。
