# 14: 编辑器、终端、diff、虚拟列表的专用库

Type: research

Blocked by: None

Status: resolved

## Question

MVP 主界面（[09](09-prototype-main-window.md#answer)）需要：长 Transcript 的虚拟列表（可变行高、流式追加、底部跟随、跳转 Turn）、工具输出与命令输出的展示、文件 diff（仓库已有 `diff` 8.0.4 计算）、代码块高亮（tech-stack 已定 shiki）。各角色在 React 19 + Tailwind 4 下选哪个维护中的库、精确版本、体积与可访问性？MVP 是否真的需要代码编辑器与交互式终端，还是只读展示即可？

## Answer

完整调研：[research/specialized-libraries.md](../research/specialized-libraries.md)。体积与 shiki 耗时在 macOS arm64 上实测（Bun 打包、Node 24 计时），未在 Electron 或 Vite 8 中运行；临时文件已清理。

- 虚拟列表：@tanstack/react-virtual 3.14.14（virtual-core 3.18.0，MIT，8.3 KB gz）。virtual-core 3.16.0 起有 `anchorTo: "end"`、`followOnAppend`，并处理流式消息在视口内增高的情况。按 Turn 虚拟化；beUI `message-scroller` 只沿用跟随语义与 rail 外观，不作为滚动容器。`@virtuoso.dev/message-list` 为商业许可，排除。
- 命令输出：Bash 工具经管道运行、没有 PTY，ANSI 只是偶发。用 anser 2.3.5（MIT，2.5 KB gz）解析 SGR，React 渲染，不用 `innerHTML`；自研预处理 `\r` 覆盖并剔除 OSC。beUI `tool-result` 保留外壳，替换把输出当 bash 源码高亮的输出区。DESIGN.md 需补 GitHub `ansi-*` token。
- diff：不引入 diff 视图库（候选或自带解析器与高亮器，或体积达 MB 级、使用 shadow DOM）。diff 8.0.4 `parsePatch` + 沿用 `view/transcript/diff-lines.ts` 的旧文、新文分别高亮，输出给改造后的 beUI `file-diff`（改用 `diff-*` token、外部传入 token、去掉流式 `aria-live`）。MVP 只做 unified。
- 高亮：shiki 4.5.0，在 renderer 中用 `shiki/core` + `createJavaScriptRawEngine` + `@shikijs/langs-precompiled` 4.5.0，主题 github-light / github-dark，`defaultColor: false` 以 CSS 变量切换明暗。不用 Oniguruma WASM（多约 620 KB，CSP 需 `wasm-unsafe-eval`）。流式代码块用 `@shikijs/stream` 4.5.0（`shiki-stream` 已归档）。beUI `agent-code` 的全量 highlighter 与无上限 `tokenCache` 需替换为共享单例。
- 编辑器与终端：MVP 不需要。spec 没有文件编辑入口，Bash 无 PTY，“在终端中打开”交给系统终端；xterm.js、CodeMirror、Monaco 留到文件编辑或 PTY 进入范围时再评估。
- tech-stack 建议条目见研究文档末尾，由 spec 采纳时写入。
- 未定：虚拟化后视口外 Turn 不在 DOM 中，屏幕阅读器与页内查找受影响（建议 `role="feed"`）；`diff-lines.ts` 能否被 `packages/ui` 复用取决于 [19](19-ui-package-layering.md)；大输入的高亮阈值或 Worker 方案需在实现时测量。
