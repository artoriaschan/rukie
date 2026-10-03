# 02: 替换 TUI 其余界面文案

Status: ready-for-agent

**What to build:** 英文环境下 TUI 所有界面文案为英文、中文环境下为中文，不再中英混杂。覆盖现有中文硬编码与英文硬编码两类。见 spec Implementation Decisions 的 TUI 节替换清单。

**Blocked by:** 01

- [ ] 状态栏：切换提示（`shift+tab`）、缓存命中率、`esc` 中断、上下文分段名（system / prompt / assistant / thinking / tools 及缩写）、`ctx`、`tps`；zh 中技术缩写可保持原值
- [ ] 审批对话框：标题、问题、按键提示
- [ ] 回到底部徽标、上下文用量警告、窗口过小提示
- [ ] compaction 通知、MCP server 错误通知
- [ ] settings warning 前缀、argv 校验错误、非交互终端提示；argv 报错发生在 settings 加载前，只按环境变量解析 locale
- [ ] 文案进 TUI 字典（zh 基准 + en `satisfies`），③ 组件仍只收 props
- [ ] 测试：TUI 字典每个 key zh / en 占位符集合一致；e2e 覆盖 en 下上述各处文本
- [ ] `tsc -b` 与全部测试通过
