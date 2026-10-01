# 09: `--resume` 回显旧对话

**What to build:** 用户运行 `neant --resume <id>` 后，先看到这个 session 之前的对话（用户消息、助手回复、工具调用摘要），然后接着对话。TUI 和 `neant-cli` 共用同一个 Session Store，两边可以互相 resume。

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] `Session` 新增只读的 `messages`，返回内存中已经还原的 context 消息，不重新读文件；在 Agent Core 公开接口上测试：resume 之后包含之前的对话
- [ ] TUI 启动时把旧的用户消息、助手文本和工具调用摘要（复用 07 的折叠行样式）写进 `Static`，然后显示输入框
- [ ] 回显不包含 system reminder
- [ ] resume 之后的新消息追加到同一个 Session
- [ ] 测试走假终端 seam：先用 `neant-cli` 或 Agent Core 产生一个 session，再用 TUI resume 并断言屏幕
- [ ] `bun run check` 全绿
