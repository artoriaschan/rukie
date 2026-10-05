# 04: TUI 宿主注入点

**What to build:** 预先重构。TUI 的剪贴板读取与外部打开改为经 `main` 注入的 `host`，测试可替换；用户可见行为不变。详见 [图片输入 spec](../spec.md) 的 TUI 宿主注入点一节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] TUI `main` 的 io 增加 `host: { readClipboard(): Promise<ClipboardContent>; openExternal(path): Promise<void> }`，默认实现为真实命令；`ClipboardContent` 形状照 spec
- [ ] 本工单默认 `readClipboard` 只实现 text / empty / unavailable（沿用现有 pbpaste / powershell / wl-paste / xclip / xsel 文本读取），files 与 image 分支留给 Ctrl+V 粘贴剪贴板工单
- [ ] question 对话框 Ctrl+V 改走 `readClipboard`；删除旧的纯文本读取函数
- [ ] 测试 `start` helper 支持注入 `host`；现有 question Ctrl+V 测试改用注入并通过
