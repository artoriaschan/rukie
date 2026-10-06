# 04: edit / write 的 unified diff

**What to build:** edit 与 write 的结果以 diff 卡呈现，覆盖文件也能看到改了什么，新建文件显示为全新增。见 [spec](../spec.md) 的「Agent Core 需补的事实」与 diff 部分。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] write 覆盖已有文件时写前读取旧内容存入 `details`；新建文件记 `oldText: null`
- [ ] 旧或新内容超过 diff 截断上限时只存统一 patch，不存全文
- [ ] edit 与 write 出 diff result view（`{ path, oldText, newText }` 或 `{ path, patch }`）
- [ ] TUI 渲染 `-` / `+` 前缀行，多文件以路径行分隔，同文件 hunk 间以 `⋯` 分隔
- [ ] diff 正文折叠为 8 行，提示与展开沿用统一规则
- [ ] resume 后 diff 卡与 live 一致
- [ ] Agent Core e2e 覆盖 write 新建 / 覆盖 / 大文件三种 `details`；TUI e2e 覆盖 diff 渲染与折叠
