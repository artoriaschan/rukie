# 08: TUI dashboard 与详情页

**What to build:**

- Agent Core：`session.interruptSubagent(id)`，中止该子代理当前的 run，父代理收到 `aborted` 通知并继续。
- TUI 新增两个整屏视图，用 chat 屏幕内的 state 做 early return，不引入路由层，完全复刻 dsh-TUI：
  - **dashboard**（`SubagentDashboard`）：Ctrl+A 打开；标题、计数、✕，卡片列表放在 `ScrollBox` 里；↑/↓ 移动，Enter 或点击进入详情，Esc / Ctrl+C 关闭，其他输入吞掉。
  - **详情页**（`SubagentDetailScene`）：固定头部；summary / output / tools 三页，←/→ 或点 tab 切换；output 页折叠 thinking、Markdown 正文、`● ` 工具行、`── Conclusion ──`，运行中自动跟随到底部；`x` 或 `X interrupt` 中断；Esc 返回进入前的位置（dashboard 或 chat，chat 恢复滚动位置）。不显示 one-shot / continuable 徽标。
- 消息流卡片点击进入详情。视图打开期间 run 继续，事件照常折叠。

**Blocked by:** 06

**Status:** ready-for-agent

参考：[spec](../spec.md)「Session API 与事件」「TUI」中的 dashboard / 详情页 / 屏幕切换；dsh-TUI `SubagentDashboard.tsx`、`SubagentDetailScene.tsx`。

- [ ] e2e：`interruptSubagent` 后父代理收到 `aborted` 通知，父 run 继续；对空闲 / 不存在的 id 为 no-op
- [ ] TUI e2e：Ctrl+A 打开 dashboard，↑/↓ + Enter 进入详情，Esc 关闭
- [ ] TUI e2e：点击卡片进入详情；←/→ 切页；运行中 output 页跟随新输出
- [ ] TUI e2e：`x` 中断后卡片变为 aborted；Esc 回到进入前的位置，chat 滚动位置不变
- [ ] i18n zh / en 齐全；`tsc -b` 与全量 `bun test` 通过
