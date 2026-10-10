# 05: 面板输入过滤

Status: ready-for-agent

Blocked by: 04

**What to build:** 面板里直接打字即可过滤，按名称、spec 或 provider 显示名做子串匹配，不区分大小写。有输入时跨 tab 平铺显示结果，清空后回到 tab 视图。Esc 先清空输入，输入为空时再按 Esc 才关闭面板。粘贴的内容同样作为过滤输入。见 spec 用户故事 6。

- [ ] 终端断言：输入 provider 显示名或 spec 片段，都能列出跨 tab 的匹配结果
- [ ] 终端断言：没有匹配时显示空状态；Backspace 删到空时回到 tab 视图
- [ ] 终端断言：Esc 第一次清空输入，第二次关闭面板
