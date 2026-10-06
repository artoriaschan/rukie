Status: resolved
Blocked by: 10

# 11: Ctrl+C 再次退出 Tips

用户要求首次 Ctrl+C 时，Tips 展示「再次按 Ctrl+C 退出」。沿用现有退出规则：空闲且输入为空时，首次 Ctrl+C 启动 1 秒窗口；再次连续 Ctrl+C 在窗口内退出。中断 Run、清空草稿、关闭浮层及交互取消继续执行各自原行为，不显示错误的退出承诺。

在现有右下角 Tips 槽位显示 zh「再次按 Ctrl+C 退出」与 en「Press Ctrl+C again to exit」，通过 frontend i18n。退出提示优先于回退和剪贴板 Tips；notice 保留现有优先级。窗口到期或被既有操作取消时清除提示，不移动输入行和光标，不修改草稿。通用 Tips 10 秒上限仍有效，退出操作窗口会提前清除；不延长现有退出时限。

## Comments

2026-10-06：基线 main `9e290a3`，工作树及分支 `codex/ctrl-c-exit-tip`。公开 seam 为 TUI start + injected host/headless terminal；先覆盖 zh/en 首按提示、到期、编辑取消、再次退出及运行中/非空草稿行为。

公开回归先 red 3 fail（首按没有提示），实现后 green 3 pass / 25 assertions。focused main、ctrl-c-exit-tip、rewind 为 100 pass / 0 fail / 512 assertions / 3 files（31.18 s）；追加同一 input chunk 双按退出/终端恢复测试 1 pass / 6 assertions。覆盖 40×12 中英布局与光标、剪贴板提示优先级、窗口过期、编辑取消、中断/草稿清除及原连续双按退出语义。oxlint、tsc -b、Knip 通过；等待双轴审查和 main aggregate 后关闭。

初轮审查：Spec 0 项发现，独立新增测试 4 pass / 31 assertions；Standards 0 项规范违约，1 项 P3 判断项（退出与回退重复的 ref/state/deadline 清理）。同一 Chat 内的两个操作窗口共用 useDoublePressWindow，保留独立 1 秒/3 秒窗口、即时按键 ref 和各自 Tips。收拢后退出提示及完整 rewind 为 56 pass / 0 fail / 329 assertions / 2 files（25.71 s），lint、tsc -b 通过。

实现 `1157d47`、审查收拢 `f83de05`，经最终双轴复核：Standards 判断项已关闭，0 项规范违约 / 0 项待处理判断项；Spec 0 项发现。main 合并提交 `80d3b13`。main 上 `rtk proxy caffeinate -is env -u NO_COLOR bun run check` exit 0：format、lint、types、Knip 和 2201 pass / 0 fail / 11397 assertions / 159 files（296.88 s）。

本次工作树 clean、分支为 main 祖先后，经非 force worktree remove 和 branch -d 清理工作树及分支，其他工作树保留；未编辑或提交其他任务的 19-mcp-remote-and-oauth.md。当前使用契约见 [输入提示](../../../apps/neant-tui/README.md#输入提示)，双轴验收见 [review](../review.md#ctrlc-退出提示后续验收)。
