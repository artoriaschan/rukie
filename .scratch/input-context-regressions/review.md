# 输入与上下文报告回归修复

## 根因与修复

- Shift+Tab 的模式切换处理没有消费输入事件。传统 backtab 不带文字，因此未暴露问题；CSI-u 的 `\x1b[9;2u` 携带 `tab`，继续进入输入框。chat 现在将该事件标记为已处理，保留原有模式切换与 Interaction 输入规则。
- committed snapshot 重建会话视图时，所有本地 context report 和 notice 都被追加到末尾。现在按照之前可见的消息锚点恢复本地条目的插入边界，保持报告之间及报告与后续消息的顺序。

## 验证

- 修复前的公开 TUI 测试：1 pass、2 fail。CSI-u 提交草稿实际为 `drafttab after`；第二次提交消息后，首个 `/context` 报告移动到了第一条用户消息之后。
- 修复后的同组测试：3 pass、0 fail。
- 相关 permissions、context-report、slash-commands、conversation 测试：49 pass、0 fail、1329 assertions，9.11s。新增测试同时覆盖传统 backtab、CSI-u、连续报告、流式回复提交与 resize；报告仍不进入模型上下文。
- `bun run check:dev`、`bun run check:docs`、`git diff --check` 通过。
- `env -u NO_COLOR bun run check` 通过：格式、lint、类型、Knip、tracker、docs、ink boundaries 及全部测试通过；3144 pass、0 fail、17965 assertions、286 files，122.11s。

## 架构覆盖与范围

沿用 ADR-0006 的输入与阅读位置规则，恢复 Frontend 本地报告已有的显示合同；未修改 Agent Core、模型协议、Transcript 格式或 renderer，不引入新的架构决定。README 同步说明快捷键消费和报告顺序。
