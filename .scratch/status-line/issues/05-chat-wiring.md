# 05: chat 屏幕接线、tps 采样与活动行压力前缀

Status: ready-for-agent

**What to build:** 见 spec 中 ④ chat 屏幕和 ③ `ActivityLine` 两节。

- `conversation.ts`：
  - Session 累计 usage，跨 Run 累加；
  - 保存最近一次 `context_usage`；
  - 采集 tps 样本：step 开始 500ms 后算实时值，`message_end` 时用实际值校正，Run 结束时入样，样本上限 500。
- `index.tsx`：换上新的 `StatusLine`；删除输入框上方的滚动提示行，改由第三行显示；活动行后缀去掉 `esc 中断`。
- `ActivityLine`：新增 `warnPct`，≥80% 时显示 `⚠ 上下文 N% · `，≥95% 改为 error 色。
- 收尾时把 `.scratch/working-activity/spec.md` 中关于后缀和滚动提示的描述同步过来。

**Blocked by:** 03, 04

- [ ] 终端 e2e：footer 在 80、60、40 列下的三行内容
- [ ] 终端 e2e：运行中第三行显示 `esc 中断`，结束后清空；活动行后缀不再出现 `esc 中断`
- [ ] 终端 e2e：滚动离开底部后第三行出现提示，输入框上方不多占一行
- [ ] 终端 e2e：悬停 ctx 或 model 显示明细，footer 高度不变
- [ ] 终端 e2e：usage ≥80% 时活动行出现 `⚠ 上下文` 前缀
- [ ] 终端 e2e：两次提交后 Session 累计 token 正确
- [ ] 手动运行 `neant`，确认分段条颜色、hover 和 tps 显示
- [ ] `bun run check` 全绿
