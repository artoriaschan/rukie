# 02: HTML 转 markdown 与内容类型

**What to build:** web_fetch 读到 HTML 页面时返回干净的 markdown（标题、代码块、GFM 表格保留，脚本、样式和隐藏元素去掉）。非 UTF-8 页面正确解码，PDF、图片等不支持的类型返回明确错误。详见 [web fetch spec](../spec.md) 的"内容类型与解码"和"HTML 转换"两节。

**Blocked by:** 01 最小安全 web_fetch

**Status:** ready-for-agent

- [ ] `text/html`、`application/xhtml+xml` 经 turndown（atx 标题、fenced 代码块、`-` 列表）加 `@joplin/turndown-plugin-gfm` 转换
- [ ] 转换前去掉 `script`、`style`、`noscript`、`iframe`、`template`、`svg`、`[hidden]`、`aria-hidden="true"`、内联 `display:none` 的元素
- [ ] 转换失败时正文替换为说明文字，不抛错
- [ ] 按 charset 用 `TextDecoder` 解码，缺省 UTF-8，未知 charset 报错
- [ ] 非文本、非 HTML 类型报 `unsupported content type <type>`
- [ ] 50K 截断作用于转换后的文本；非 2xx 的错误附文同样经过转换
- [ ] 新依赖精确锁版本并写入 `docs/tech-stack.md`
- [ ] e2e 覆盖：标题、代码块、表格保留；脚本、隐藏元素被去掉；非 UTF-8 charset 正确解码；PDF / PNG 报 unsupported
