# 04: 面板 provider tabs 与模型行

Status: claimed

Blocked by: 03

**What to build:** `ModelPicker` 改为按 provider 分 tab 显示。见 spec 用户故事 1–5 与「TUI」部分。

- 可见 provider 的过滤和 tab 排序放在 `view/`；打开时停在当前模型所在的 tab 和当前模型上；每个 tab 单独记住焦点。
- 模型行显示“名称 + 灰色 spec”，当前模型标 ✓，名称和 spec 相同时只显示 spec。截断顺序：先截名称，最后截 spec。
- 空间够时显示能力摘要。
- 没有凭据的自定义模型置灰并标“未配置凭据”，按 Enter 只提示，不切换。
- 底部说明行显示；加载中和加载失败两种状态；zh 和 en 文案。

- [ ] 终端断言：Tab / Shift+Tab 循环切换，切回原 tab 时焦点还在
- [ ] 终端断言：重名模型（同名、不同 provider 或不同 id）各自显示出能区分的 spec
- [ ] 终端断言：没有凭据的内置 provider 不显示；置灰的自定义模型按 Enter 时出现提示，模型不变
- [ ] 终端断言：加载中时显示“加载中”，不先列出全部模型
