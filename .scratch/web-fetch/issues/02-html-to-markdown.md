# 02: HTML 转 markdown 与内容类型

**What to build:** web_fetch 读到 HTML 页面时返回干净的 markdown（标题、代码块、GFM 表格保留，脚本、样式和隐藏元素去掉）。非 UTF-8 页面正确解码，PDF、图片等不支持的类型返回明确错误。详见 [web fetch spec](../spec.md) 的"内容类型与解码"和"HTML 转换"两节。

Blocked by: 01 最小安全 web_fetch

Status: resolved

- [x] `text/html`、`application/xhtml+xml` 经 turndown（atx 标题、fenced 代码块、`-` 列表）加 `@joplin/turndown-plugin-gfm` 转换
- [x] 转换前去掉 `script`、`style`、`noscript`、`iframe`、`template`、`svg`、`[hidden]`、`aria-hidden="true"`、内联 `display:none` 的元素
- [x] 转换失败时正文替换为说明文字，不抛错
- [x] 按 charset 用 `TextDecoder` 解码，缺省 UTF-8，未知 charset 报错
- [x] 非文本、非 HTML 类型报 `unsupported content type <type>`
- [x] 50K 截断作用于转换后的文本；非 2xx 的错误附文同样经过转换
- [x] 新依赖精确锁版本并写入 `docs/tech-stack.md`
- [x] e2e 覆盖：标题、代码块、表格保留；脚本、隐藏元素被去掉；非 UTF-8 charset 正确解码；PDF / PNG 报 unsupported

## Comments

- 2026-10-05：以 integration `9b5612e`（01 已 resolved、完整 check 1768/0）为基线，在独立 worktree 按 `tdd` 从 Session + fake model + 本地 HTTP server 的公开入口验证；首次 HTML 测试确认原始标签泄漏，未知 charset 测试确认原错误不可精确识别，colspan 10000 测试确认插件生成 120034 字符的膨胀结果后完成修复。
- `content.ts` 使用 turndown + GFM，先复用其依赖的 domino DOM 删除活动/隐藏元素（包括 html/body 根及 GFM 保留原 HTML 的表格），保留代码语言、标题、列表与表格；Markdown 无合并单元格语义，因此在转换前去掉 colspan/rowspan，防止数值 span 造成不受正文上限限制的转换分配。深度异常转换返回固定说明，不返回原始 HTML。
- 依赖精确锁定 turndown 7.2.4、GFM 1.0.68、domino 2.2.0、@types/turndown 5.0.6，并更新 Bun lockfile 与 tech-stack；domino 是 turndown 已使用的 DOM，直接依赖让转换前过滤可用且不另引入解析器。最小 ambient 声明只覆盖实际调用方法；`node:util` TextDecoder 支持运行时验证的任意 charset label，未知 label 返回 `Unsupported charset`。
- 验证：`rtk proxy bun test packages/agent/tests/e2e/web-fetch-html.test.ts packages/agent/tests/e2e/web-fetch.test.ts` → 64 pass / 0 fail；`rtk proxy bunx --no -- oxlint`、`rtk proxy bunx --no -- tsc -b`、`rtk proxy bunx --no -- knip` 通过；新增 13 个 HTML/charset/转换后截断及错误附文用例，PDF/PNG 与原样 JSON/XML 覆盖沿用 01 的公开用例。最终整合分支再运行完整 check。

- 交付前已快进合入 integration `2f52203`（03 重定向）；三份公开 e2e `web-fetch-html` / `web-fetch-redirects` / `web-fetch` 共同验证 78 pass / 0 fail（218 assertions），完整 Oxfmt / Oxlint / TypeScript / Knip / diff whitespace 检查通过。HTML ambient 声明使用 source-path reference 供跨 workspace 源码消费者加载，单行 lint 例外写明不能改成 module augmentation 的原因。

### 2026-10-05 integration review fixes

- Spec 审阅发现 GFM 转换超宽表格同步占用事件循环，超时和中止无法及时执行。公共 Session 的 5000 单元格表格 RED 为 1364 ms；修复后同一用例约 34–57 ms 返回既有转换省略说明，后续抓取可用。
- HTML 转换限制标签数 10000、DOM 深度 128、单元格总数 1000，复杂输入在进入昂贵的 GFM 转换前省略；不增加设置、生产开关或测试 seam。不设置额外 HTML 字符上限，1.1M 字符的简单 HTML 公共回归仍保留可读标题/正文并按既有 50K 上限截断（RED 省略后 GREEN 约 51 ms）。
- HTTP 错误附文也包含与成功结果相同的不可信声明，正文仍独立限为 2K 字符。Core/TUI/Headless focused 验证与最终集成验收见 01 的同日审阅记录。

### 最终集成验证

实现及审查修复已合入 `codex/web-fetch-integration`；全量检查与双轴复核证据见 [Spec Delivery](../spec.md#delivery)。
