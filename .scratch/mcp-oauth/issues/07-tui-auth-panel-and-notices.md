# 07: TUI 授权面板与 notice

**What to build:** TUI 用户在 server 需要授权时收到一次提示；模型调用 `authenticate` 时，输入框位置出现照 dsh OAuth 登录复刻的授权面板，可以自动或手动打开浏览器、复制链接、粘贴回调 URL；授权结果用 notice 反馈。详见 [MCP OAuth spec](../spec.md) 的 TUI 一节。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] host 新增 `writeClipboard(text): Promise<boolean>`（依次尝试 pbcopy、wl-copy、xclip、xsel、clip.exe）；`openExternal` 接受 URL，文件路径保持现有行为；测试 helper 提供默认 stub
- [ ] `onMcpAuth` 复用 question 面板，和审批、提问共用同一个槽位与 FIFO 队列；布局为 `◈ <server>`、问题、detail（动作结果、引导语、完整 URL）、复制授权链接 / 重新打开浏览器 / 取消登录、粘贴回调 URL 的自定义回答栏
- [ ] 打开面板时调用 `openExternal(url)`，按成功或失败选择引导语；复制和重新打开的结果插到 detail 第一行（文案照 dsh 原文）；取消或 Esc 返回 `cancelled`；`signal` abort 时关闭面板；没有 spinner
- [ ] notice：成功 `已登录 MCP 服务器 {{name}}`（success，4 s），失败 `OAuth 登录失败 · {{err}}`（error，8 s），取消 `已取消 MCP 授权`（dim）；收到 `mcp_auth_required` 时每个 session 每个 server 只显示一次 warning `MCP 服务器 {{name}} 需要授权 · /mcp login {{name}}`
- [ ] zh / en 文案同步
- [ ] TUI e2e：模型调用 authenticate 后出现面板，`openExternal` 收到 URL；复制和重新打开的行为；打开失败时的引导语；本地回调到达后自动关闭并出现成功 notice；粘贴路径；取消；和审批面板排队；needs-auth notice 只出现一次；40×12 下 URL 能换行
- [ ] 默认的 `writeClipboard` / `openExternal(URL)` 在 macOS 上手动验证并记录
