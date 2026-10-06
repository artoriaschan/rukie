# 11: transcript 搜索

**What to build:** 在 transcript 模式下用户按 `/` 搜索整段对话，`n` / `N` 在匹配间跳转；退出后输入框的 `/` 命令补全照常工作。见 [spec](../spec.md) 的「TUI 工具卡」按键部分。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] transcript 模式下 `/` 进入搜索输入，回车后高亮匹配并跳到第一处
- [ ] `n` / `N` 前后跳转，无匹配时显示提示
- [ ] Esc 或 `ctrl+o` 退出 transcript 模式，按键交回输入框，`/` 恢复为命令补全
- [ ] run 中可进入
- [ ] zh / en 文案
- [ ] TUI e2e 覆盖搜索、跳转、退出后 `/` 行为与阅读位置
