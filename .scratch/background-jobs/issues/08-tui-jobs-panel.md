# 08: TUI /jobs 面板

**What to build:** TUI 用户用 `/jobs` 或点击 JobCard 打开整屏 JobsPanel，查看每个 job 的输出和时间线，并能手动停止 job。照 dsh-TUI 窄屏 overlay 复刻。详见 [后台 bash spec](../spec.md) 的 TUI 一节。

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] 新增内置 Slash Command `/jobs`，run 进行中也可以用；在 chat 屏幕内整屏 early return，与 subagent dashboard 的做法一致
- [ ] 列出本 session 的全部 job；↑/↓ 选择；`e` 展开详情（输出尾部、时间线、spill 路径、丢数据提示）
- [ ] `k` 第一次按下显示确认提示，4 s 内再按一次才调用 `killJob`；超时后确认失效
- [ ] Esc 返回 chat，阅读位置不变；点击 JobCard 打开面板并聚焦这个 job
- [ ] zh / en 文案、命令补全描述同步
- [ ] TUI e2e：按键流程、停止后 Session 收到 `killJob`、Esc 返回后的滚动位置、run 进行中打开、小终端下正常显示
