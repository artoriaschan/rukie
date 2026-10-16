# 01：主输入框换成 Lexical（预重构）

Status: ready-for-agent
Blocked by: None (can start immediately)

**What to build:** 按 [spec](../spec.md) 的「编辑器」一节与 [ADR-0048](../../../docs/adr/0048-lexical-composer-editor.md)，把桌面与 Web 主输入框从 textarea 换成 Lexical 纯文本编辑器。用户感知不到任何变化：发送内容、键盘行为、图片附件、焦点与尺寸都与现在一致。这一步只为后续技能标记腾出编辑器模型，不新增功能。

- [ ] 新增 Lexical 依赖，精确锁定版本，更新 tech-stack 与 Bun 锁文件
- [ ] 输入框对外仍以纯文本草稿和图片作为发送输入，所有调用方无需改动语义
- [ ] 回车发送、Shift+回车换行、输入法合成期间不发送、图片粘贴、焦点交接、禁用与提交中状态与现在一致
- [ ] 自动增高与输入框几何不变，布局保护流程下现有基线无差异
- [ ] 现有输入框、紧凑输入框、输入焦点浏览器测试全部通过，不削弱断言；新增 Lexical 相关回归覆盖输入法与粘贴
- [ ] 受影响的类型检查、oxfmt、oxlint、knip 通过

## Comments
