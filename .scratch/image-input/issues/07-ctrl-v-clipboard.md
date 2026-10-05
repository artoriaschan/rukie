# 07: Ctrl+V 粘贴剪贴板

**What to build:** 用户在输入框按 Ctrl+V：剪贴板是复制的文件时图片成 token、其他文件插入路径；是图片时成 token；是文本时插入文本；为空、不可用或格式不支持时给出对应提示。详见 [图片输入 spec](../spec.md) 的剪贴板默认实现与提示文案两节。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] 输入框 Ctrl+V 调用 `host.readClipboard`，按 files → image → text 分支处理；empty / unavailable / 格式不支持各自 notice
- [ ] 默认实现：macOS `osascript` 依次取 `«class furl»`、`«class PNGf»`（写入 0700 临时目录 0600 文件）、`pbpaste`；Linux 按 `wl-paste --list-types` / `xclip -t TARGETS` 选 `text/uri-list`、`image/png`、文本；Windows 只取文本；临时文件退出时清理
- [ ] TUI e2e（注入 `host`）：image → token + notice；files（图片 + 非图片）→ token + 路径文本；text → 插入；empty / unavailable / 不支持格式 → notice；question 对话框 Ctrl+V 仍为文本
- [ ] macOS 手动验证截图粘贴与 Finder 复制文件，记录在本工单 Comments
