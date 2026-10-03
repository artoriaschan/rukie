# 02: TUI 模式切换与状态栏显示

Status: resolved

**What to build:** TUI 用户按 shift+tab 在 `ask → auto-review → full-access → ask` 间循环切换，切换立即作用于 session；状态栏 row 2 第一个字段始终显示当前模式。见 spec Implementation Decisions 的 TUI 节。

**Blocked by:** 01

- [x] shift+tab 循环切换并调用 `session.setPermissionMode`
- [x] 审批对话框打开时 shift+tab 被忽略
- [x] 切换只作用于当前 session，不写回 settings；resume 回到默认模式
- [x] 切换不注入任何 system reminder
- [x] 状态栏 row 2 第一位 `mode` 字段，`full-access` 用 danger 色；hover 详情含模式说明与 shift+tab 提示
- [x] StatusLine 仍只收 props（mode 由 chat screen 传入）
- [x] chat screen / status-line 测试覆盖以上行为

## Comments

2026-10-03：完成。Chat screen 从 Session 当前模式初始化状态，shift+tab 按 `ask → auto-review → full-access → ask` 循环并同步调用 `session.setPermissionMode`。连续按键读取 Session 实时值，审批打开时完全忽略 shift+tab，普通 Tab 详情切换继续沿用原行为。

StatusLine 新增 `mode` props，作为字段行第一位；`full-access` 使用主题的危险色 `error`。窄屏优先保留完整模式名；hover 按显示列宽选择完整或简短说明，在 40 / 60 / 80 列均保留模式说明和 shift+tab 提示。

行为测试覆盖运行中切换后的工具执行/拒绝、审批期间屏蔽、草稿保留、连续按键、用户/项目 settings 不变、无新增 system reminder，以及 resume 恢复 `ask` / `auto-review` 默认值。`auto-review` 的评审机制仍由 03 负责，本单使用 01 已提供的暂按 ask 判定行为。

验证：新行为与窄屏 hover 回归均先 red 后 green；阶段性定向测试和 `bunx tsc -b` 通过。最终 `rtk proxy env -u NO_COLOR bun run check` 通过格式、Lint、类型检查、Knip 和全部 430 项测试（0 fail，2525 assertions）。

### Standards

未发现仓库规范违规或需要处理的代码异味；Chat screen 持有 Session 和状态，StatusLine 只收 typed props，测试通过公开终端和模型边界验证行为。

### Spec

初审发现窄屏 hover 长说明会截掉 shift+tab 提示；已补充短文案和 40 / 60 / 80 列回归测试。复审未发现剩余缺项、错误行为或范围扩张。

审查结果：Standards 0 项问题；Spec 1 项已修复，0 项剩余问题。
