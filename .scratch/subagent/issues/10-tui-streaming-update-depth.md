# 10: TUI 流式输出触发 React 更新深度限制

Status: resolved

**Problem:** 本地验证时，两个子代理正常完成，父代理汇总阶段保存了 `Maximum update depth exceeded` 错误。聊天屏幕必须能够持续接收流式事件，保留滚动阅读位置与未读提示，并在完成后接受下一次输入。

**Root cause:** Chat 的未读 effect 在每次输出更新后重复调用值未变化的 `setUnread`。React 外部 store 的同步更新使同值 setter 的快速跳过不能成立，重复更新最终触发嵌套限制。子代理事件通知的合并并不能覆盖父代理最终汇总。

**Fix:** 只在未读标记真正变化时设置状态，将 `unread` 纳入 effect 依赖；不改变 Session 事件或通知顺序。

- [x] 公开 TUI 回归：350 个流式片段可正常结束，最终文本进入下一次模型请求的历史，并可继续输入
- [x] 公开 TUI 回归：向上阅读时保持位置，显示新输出提示，Ctrl+End 清除提示并跟随尾部
- [x] 类型、相关测试与完整检查通过
- [x] Standards / Spec 双轴评审通过

## Evidence

- 真正失败的父会话：`01a106cb-e5e3-7277-8255-084bb9d84afe`。两个子会话正常结束；父会话最后一个 assistant 消息记录 React 更新深度错误。
- RED：无子代理、无导航的公开 TUI 测试也能复现，350 个文本片段之间让模型事件处理经过两个微任务边界。错误经过 `conversation.onEvent → update → external-store listener → forceStoreRerender` 抛出。
- GREEN：相同测试加入向上阅读场景后，2 pass / 0 fail / 7 assertions。完成后的下一次模型请求含完整最终文本。
- 独立最小诊断：外部 store 更新单独可完成 350 次；effect 每次重复设置相同布尔值时第 53 次失败；给 setter 加状态变化条件后完成 350 次。诊断文件已移除。
- 相关组合测试：58 pass / 0 fail / 383 assertions；`tsc -b` 退出 0。
- 完整 `env -u NO_COLOR bun run check` 退出 0：1103 pass / 0 fail / 6049 assertions / 83 files，124.17 秒；日志 `/tmp/neant-update-depth-full.log`。
- Standards / Spec 各 0 findings；两位评审者各自独立运行公开回归：2 pass / 0 fail / 7 assertions。
