# 07: 语法高亮

**What to build:** 工具卡里的参数 JSON 与文件内容按语言着色。见 [spec](../spec.md) 的「渲染组件」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 选定高亮依赖（参考 dsh 的 `cli-highlight` + `highlight.js`），精确锁版本，更新 `docs/tech-stack.md` 与 Bun lockfile
- [ ] generic 卡 `Name(args)` 的 args 以 JSON 高亮
- [ ] 正文 plain 行按文件扩展名高亮；未知扩展名不高亮
- [ ] 已有 diff / split diff 时其内容也按扩展名高亮
- [ ] 颜色走主题 token，不在组件中硬编码
- [ ] TUI e2e 断言高亮行的样式输出
