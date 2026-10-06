# 07: TUI statusline chip、JobCard 与结束 notice

**What to build:** TUI 用户在 statusline 看到运行中 job 的数量，在转录里看到每个 job 的卡片和实时输出，job 结束时有提示。照 dsh-TUI 复刻。详见 [后台 bash spec](../spec.md) 的 TUI 一节。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] statusline 有 running / stopping 的 job 时显示 `● N`，悬停列出 label 和已运行时长
- [ ] JobCard 挂在发起它的 bash 工具卡下（显式后台调用或超时转后台）：`❯ <command>`、● / ✓ / ✗、最近 2 行输出（经 `readJob`）
- [ ] 连续 2 张及以上 JobCard 由 JobGroupHeader 合成一组，全部结束后折叠成一行摘要，Ctrl+O 展开；确认不与现有按键冲突
- [ ] job 结束时用现有 notice 提示，约 6 s 后消失，完成、失败、被杀分别用对应文案
- [ ] zh / en 文案同步
- [ ] TUI e2e：chip 出现和消失、卡片状态和输出更新、合组与折叠、notice；40×12 与 resize 下不溢出
