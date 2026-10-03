# 05: transcript 中的 `todo_write` 工具卡

**What to build:** TUI 用户在 transcript 里看到 `todo_write` 调用显示为"待办清单"加一行进度摘要和进行中项，回看历史时每张卡反映当时那一版清单。

**Blocked by:** 01（`todo_write` 写入并在 resume 后恢复）

**Status:** ready-for-agent

参考：[spec](../spec.md)「TUI」transcript 工具卡；dsh-TUI `src/dsh-adapter/channel/transcript.ts`；Neant 现有 `ask_user_question` 摘要做法。

- [ ] 工具名显示"待办清单"（en: `TodoWrite`）
- [ ] 摘要 `todos ✓ done/total`，其后每个 in_progress 项 `● content`，整卡最多 4 行
- [ ] 从该次工具调用参数渲染，不读 Tool State
- [ ] 工具出错时按现有错误卡呈现
- [ ] 不做前后快照 diff
- [ ] 中英文案

测试（seam 2）：

- [ ] 摘要与 4 行上限
- [ ] 多次写入时各卡显示各自那一版
- [ ] 错误调用呈现
- [ ] 中英文案
