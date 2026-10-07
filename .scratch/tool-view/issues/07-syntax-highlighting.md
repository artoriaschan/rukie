# 07: 语法高亮

**What to build:** 工具卡里的参数 JSON 与文件内容按语言着色。见 [spec](../spec.md) 的「渲染组件」。

**Blocked by:** 01

**Status:** resolved

- [x] 选定高亮依赖（参考 dsh 的 `cli-highlight` + `highlight.js`），精确锁版本，更新 `docs/tech-stack.md` 与 Bun lockfile
- [x] generic 卡 `Name(args)` 的 args 以 JSON 高亮
- [x] 正文 plain 行按文件扩展名高亮；未知扩展名不高亮
- [x] 已有 diff / split diff 时其内容也按扩展名高亮
- [x] 颜色走主题 token，不在组件中硬编码
- [x] TUI e2e 断言高亮行的样式输出

## Answer

- `highlight.js` 11.12.0 精确锁定在 `@neant/tui`，Bun lockfile 与 `docs/tech-stack.md` 已同步。直接使用稳定的 `highlight(...).value` API，将 lexer span 映射为主题 token，避免 ANSI 桥接依赖。
- 设计系统公开 `highlightSyntax(text, { language?, path? })` 与 `SyntaxHighlightedText` / `SyntaxRun`。先 lex 全文再按行选取，read 和 unified diff 保留跨行注释 / 字符串状态；split 可复用完整旧、新源文本的 runs（05 实现布局）。未知扩展名保持 plain，不做自动语言猜测。
- generic 参数 JSON、read 文件和 unified diff 内容使用语法色；状态与 diff 前缀仍保留类别 / add / del 色。语法类别使用现有 theme token，不硬编码组件颜色。README 说明完整文本、窗口与 split 的调用约定。
- 红灯：JSON 字符串颜色为 plain；diff 多行注释旧行颜色为 del；read 在 06 接线前为 plain。绿灯：经公开 `start` / headless terminal 的 RGB cell 断言，JSON、read 多行注释与未知扩展名、diff 旧/新行语法通过（78 / 96 / 93 ms）。
- 验证：`env -u NO_COLOR bun test apps/neant-tui/tests/e2e/{tool-syntax,remaining-tool-views,tool-view,file-diff}.test.ts` 共 11 通过、50 断言、1.61s；`bunx --no -- tsc -b`、Oxlint、Knip 通过。整套 aggregate 由 integration 最终统一执行。
- Integration 已同步 `c187ae6`，保留 02 展开 / hover、04 unified diff、06 read/search/web/goal/MCP 行为。源码提交 `b01511d`，整合提交 `7f67bcc` / `c115991`。
