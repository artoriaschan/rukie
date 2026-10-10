# 研究：编辑器、终端、diff、虚拟列表的专用库

回答 [工单 14](../issues/14-research-specialized-libraries.md)。调查时间 2026-10-10。版本基线：React 19.3.0、Tailwind CSS 4.3.3、Vite 8.3.1、Electron 41.0.3（tech-stack），diff 8.0.4（仓库已装），候选库取 npm `latest`：@tanstack/react-virtual 3.14.14（@tanstack/virtual-core 3.18.0）、react-virtuoso 4.18.16、@virtuoso.dev/message-list 1.18.1、virtua 0.53.3、use-stick-to-bottom 1.1.6、anser 2.3.5、ansi-to-react 6.2.6、fancy-ansi 0.1.3、ansi_up 6.0.6、@xterm/xterm 6.0.0、react-diff-view 3.3.3、@git-diff-view/react 0.1.7、react-diff-viewer-continued 4.4.0、@pierre/diffs 1.5.2、shiki 4.5.0、@shikijs/langs-precompiled 4.5.0、@shikijs/stream 4.5.0、shiki-stream 0.1.5、@uiw/react-codemirror 4.25.12、monaco-editor 0.57.0、@monaco-editor/react 4.7.0。

来源：

- npm registry 元数据（`https://registry.npmjs.org/<pkg>`：版本、许可证、依赖、peer、发布时间、unpackedSize）。
- 已发布 tarball 中的源码与类型声明（`npm pack` 解包）。
- GitHub REST API（star、最后推送、open issue、是否归档）。
- beUI registry 端点 `https://beui.dev/r/{message-scroller,code-block,file-diff,tool-result,agent-activity}.json` 中的组件源码。
- 仓库源码：`packages/agent/src/tools/jobs/registry.ts`、`packages/coding-agent/src/view/transcript/diff-lines.ts`、`packages/coding-agent/src/view/transcript/job-output.ts`。
- 本地实验（标“实测”），环境为 macOS arm64、Bun 1.4.2、Node 24.15.0：体积用 `bun build --minify --target=browser` 测量（外置 react/react-dom），再 `gzip -9`；shiki 耗时在 Node（V8，与 Chromium renderer 同一引擎）下测量。没有在 Electron 或 Vite 8 中运行，没有做浏览器内滚动实验。临时目录 `/tmp/rukie-research-14-*` 已删除。

未标注的结论为“阅读”（来自源码、类型或文档）。

## 结论

1. 虚拟列表：选 @tanstack/react-virtual 3.14.14（virtual-core 3.18.0，MIT）。virtual-core 自 3.16.0（2026-05-25）起提供 `anchorTo: "end"` 与 `followOnAppend`，并处理了“流式消息在视口内增高时不拖动视口”（#1218）。它是 headless，与 beUI 和 DESIGN.md 不冲突，beUI 的 `table`、`infinite-masonry` 也依赖它。按 Turn 虚拟化（已完成的 Turn 默认折叠），虚拟化器负责滚动与底部跟随，beUI `message-scroller` 不作为滚动容器。react-virtuoso 的消息列表产品 `@virtuoso.dev/message-list` 是商业许可，排除；其核心 MIT 可作为备选。
2. 工具与命令输出：Bash 工具经管道运行（`stdio: ["ignore", "pipe", "pipe"]`，非 PTY），ANSI 只是偶发情况。用 anser 2.3.5（MIT，2.5 KB gz，实测）把 SGR 解析为 JSON，自行渲染为 React span，不使用 `innerHTML`；渲染前剔除 OSC 与非 SGR 控制序列并处理 `\r` 覆盖。beUI `tool-result` 只保留外壳，换掉其把输出当 bash 源码高亮的 `ToolResultOutput`。
3. diff：不引入 diff 视图库。用 diff 8.0.4 `parsePatch` 加 shiki 自研薄适配层，沿用 `view/transcript/diff-lines.ts` 的做法（旧文与新文分别高亮），输出给改造后的 beUI `file-diff`，颜色改为 `diff-*` token，词级高亮用 `diffWordsWithSpace` 对应 `--diff-*-word`。候选库要么自带解析或高亮器（highlight.js、refractor、emotion），要么体积达 MB 级并使用 shadow DOM。
4. 代码高亮：shiki 4.5.0，在 renderer 中用细粒度 `shiki/core` + `createJavaScriptRawEngine` + `@shikijs/langs-precompiled` 4.5.0，主题从 `@shikijs/themes/github-light`、`github-dark` 导入，`defaultColor: false` 输出 `--shiki-light/--shiki-dark` 两套 CSS 变量，由 `.dark` 切换。不用 Oniguruma WASM：体积多约 620 KB 未压缩，CSP 还需 `wasm-unsafe-eval`。流式代码块用 `@shikijs/stream` 4.5.0 的 `ShikiStreamTokenizer`；`shiki-stream` 仓库已归档，已并入 shiki。beUI `agent-code` 的高亮模块须替换为共享 highlighter。
5. MVP 不需要代码编辑器，也不需要交互式终端，只读展示即可。spec 中没有文件编辑入口，输入框是多行文本框；Bash 工具没有 PTY，无法运行交互程序；“在终端中打开”交给系统终端。xterm.js 6.0.0（87 KB gz）、CodeMirror（128 KB gz）、Monaco 留到文件编辑或 PTY 进入范围时再评估。

## 1. 长 Transcript 虚拟列表

需求来自 [spec](../spec.md#主区域)：可变行高；当前 Turn 流式增长（最后一行变高）；底部跟随，读者上滑后停止跟随；Turn 刻度点击跳转；已完成的 Turn 折叠，展开后行高突变。

| 库                         | 版本    | 许可证     | min / gz（实测）  | 维护                                                             | 底部跟随与流式                                                                                                                           | 跳转                                                     |
| -------------------------- | ------- | ---------- | ----------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| @tanstack/react-virtual    | 3.14.14 | MIT        | 27.9 KB / 8.3 KB  | TanStack 组织，7134 star，2026-10-09 推送，virtual-core 同日发布 | `anchorTo: "end"`、`followOnAppend`、`scrollEndThreshold`；行在视口内增高时贴底保持（源码 `resizeItem` 中 `wasAtEnd` 分支与 #1218 注释） | `scrollToIndex(i, { align })`，`measureElement` 实测行高 |
| react-virtuoso             | 4.18.16 | MIT        | 60.6 KB / 20.2 KB | 个人（petyosi）为主，6466 star，2026-10-01 推送                  | `followOutput`、`alignToBottom`、`atBottomStateChange`、`atBottomThreshold`                                                              | `scrollToIndex`                                          |
| @virtuoso.dev/message-list | 1.18.1  | Commercial | 未测              | 闭源仓库                                                         | 专为聊天设计                                                                                                                             | 有                                                       |
| virtua                     | 0.53.3  | MIT        | 8.2 KB / 4.2 KB   | 个人（inokawa），3751 star，2026-10-10 推送，0.x                 | 只有 `shift`（向前插入时保持位置）；底部跟随需自行用 `scrollSize`/`scrollToIndex` 实现                                                   | `scrollToIndex`、`findItemIndex`                         |
| use-stick-to-bottom        | 1.1.6   | MIT        | 5.5 KB / 2.1 KB   | StackBlitz Labs，779 star，2026-06-04 推送                       | 只做贴底，不做虚拟化                                                                                                                     | 无                                                       |

- @virtuoso.dev/message-list 的 LICENSE 原文为 “React Virtuoso Message List … is commercial software. You MUST agree to the End User License Agreement”，需购买或仅限试用；react-virtuoso 核心包 LICENSE 为 MIT。两者不是同一个包。
- TanStack 的 `anchorTo`/`followOnAppend` 在 3.15.0 及更早版本中不存在（实测：解包 3.13.0–3.17.0 的类型声明），所以版本必须不低于 virtual-core 3.16.0。@tanstack/react-virtual 3.14.14 精确依赖 virtual-core 3.18.0。
- beUI 现状：`message-scroller` 不做虚拟化，自己持有 viewport，用 ResizeObserver 加 `scrollTo(scrollHeight)` 跟随，默认 `followThreshold` 56 px，带消息导航 rail。它与虚拟化器争夺滚动容器，不能直接叠加。可以沿用它的语义（离开底部后停止跟随、`onFollowChange`、`busy`）和外观，滚动本身交给 TanStack。spec 中的 Turn 刻度对应它的 rail，需要改为按 Turn 计数。
- 行粒度：按 Turn 虚拟化，不按消息或工具调用。已完成的 Turn 只显示最终回复，行数与 Turn 数相同；当前 Turn 是最后一行，流式增长正好对应 `followOnAppend` 与 #1218 的场景。展开一个 Turn 会导致其行高突变，TanStack 默认只补偿完全位于视口上方的行，展开发生在视口内时不跳动（阅读，未在浏览器实测）。
- 可访问性：虚拟化后视口外的 Turn 不在 DOM 中，屏幕阅读器读不到，Chromium 页内查找（Electron `webContents.findInPage`）也找不到。建议容器用 `role="feed"`，每个 Turn 为 `article`，带 `aria-setsize`/`aria-posinset`，Turn 刻度提供键盘跳转。对话内搜索在 spec 中没有要求，记为待定。
- 不引入 virtua：体积最小，但它是 0.x，由个人维护，不提供贴底跟随；而底部跟随正是本场景中最容易出错的部分。

## 2. 工具与命令输出

Agent Core 现状（阅读）：`tools/jobs/registry.ts` 以 `spawn("bash", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] })` 运行命令，没有 PTY，也没有设置 `TERM`、`FORCE_COLOR`。大多数 CLI 检测到非 TTY 会关闭颜色，但用户环境中的 `FORCE_COLOR`、`git -c color.ui=always`、`ls --color=always` 以及部分构建工具仍会输出 SGR、`\r` 进度条和 OSC 8 超链接。TUI 在 `view/transcript/job-output.ts` 中用 `Bun.stripANSI` 剔除控制序列；renderer 中没有 Bun API，这段代码不能直接复用。

实测输入为 `"\x1b[31merror\x1b[0m <script>x</script> \x1b[1;32mok\x1b[0m\r\nprogress 10%\rprogress 100%\n\x1b]8;;https://e.x\x07link\x1b]8;;\x07"`：

| 库            | 版本  | 许可证       | min / gz（实测）   | 维护                        | 输出形式与实测行为                                                                                                                     |
| ------------- | ----- | ------------ | ------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| anser         | 2.3.5 | MIT          | 6.9 KB / 2.5 KB    | 2025-12-15 发布             | JSON 片段（`content`、`fg`、`bg`、`decorations`），`use_classes` 输出 `ansi-red` 等类名；OSC 与 `\r` 原样留在 `content` 中，需要预处理 |
| ansi-to-react | 6.2.6 | BSD-3-Clause | 22.2 KB / 7.9 KB   | nteract，2026-01-24 发布    | 基于 anser 的 React 组件，附带 linkify-it 和 escape-carriage；把 URL 变成可点击 `<a>`                                                  |
| fancy-ansi    | 0.1.3 | Apache-2.0   | 8.8 KB / 3.3 KB    | 2024-09-09 后未发布         | HTML 字符串，转义了 `<script>`，剔除 OSC 8，支持 256 色与真彩色，颜色走 `--ansi-*` CSS 变量；需 `dangerouslySetInnerHTML`              |
| ansi_up       | 6.0.6 | MIT          | 13.5 KB / 2.9 KB   | 2025-05-16 发布             | HTML 字符串，把 OSC 8 转成 `<a href="https://e.x">`；需 `innerHTML`                                                                    |
| @xterm/xterm  | 6.0.0 | MIT          | 343.8 KB / 87.2 KB | 21258 star，2026-09-13 推送 | 完整终端仿真，每个实例一套网格与渲染器                                                                                                 |

选择 anser：

- 只解析不渲染，React 直接渲染文本节点，不经过 `innerHTML`。工具输出来自不受信任的命令，这一点在 Electron 中尤其重要。
- 颜色用 `use_classes` 映射到类名，再由 CSS 映射到 GitHub 的 ANSI 色。`@primer/primitives` 11.10.0 的 functional theme 有 `ansi-black` 到 `ansi-whiteBright` 共 17 个 token（实测解包），可按 DESIGN.md 现有做法复制数值，Light/Dark 各一套。DESIGN.md 目前没有 `ansi-*` token，需要补充。
- 预处理（自研，约几十行）：`\r\n` 归一；按行处理 `\r` 覆盖，只保留最后一段；剔除 OSC 及非 SGR 的 CSI 序列。不把 OSC 8 渲染成链接：Electron 中的链接导航需要经 host 接口审查，属于新功能。
- ansi-to-react 默认 linkify 并多带两个依赖；fancy-ansi 一年多未发布，且依赖 `innerHTML`；ansi_up 会生成 `<a href>`。三者都不选。
- xterm.js 只读模式对管道输出没有收益。Transcript 中会有大量输出块，每块一个终端实例无法与虚拟列表共存；复制、选择、查找和屏幕阅读器支持都比普通 DOM 文本差。

beUI 现状：`tool-result` 的 `ToolResultOutput` 把输出交给 `AgentCode`，默认 `language="bash"`，即把命令输出当作 bash 源码高亮。这对普通输出是错的，对带 ANSI 的输出会显示乱码。保留 `ToolResult` 的折叠外壳、状态与复制按钮，输出区换成 ANSI 渲染器。是否改为与 TUI 一致直接剔除 ANSI，可在实现工单中按成本决定；两种方式都不需要终端库。

## 3. 文件 diff

数据现状（阅读）：Agent Core 在 `tools/file-diffs.ts` 与 `file-tracking/index.ts` 中用 `createTwoFilesPatch` 生成 unified patch，作为 `card: "diff"` 的 `patch` 或 `oldText`/`newText` 进入工具视图。TUI 的 `view/transcript/diff-lines.ts` 用 `parsePatch` 拆出 hunk，旧文与新文分别整体高亮，再按行号取回 token。这样删除行与新增行各自使用正确的语法状态。

| 库                          | 版本  | 许可证       | min / gz（实测）                                           | 问题                                                                            |
| --------------------------- | ----- | ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| react-diff-view             | 3.3.3 | MIT          | 54.5 KB / 18.7 KB                                          | 自带 gitdiff-parser 与 diff-match-patch，依赖 lodash；与 `diff` 的解析结果重复  |
| @git-diff-view/react        | 0.1.7 | MIT          | 1150 KB / 345 KB                                           | 内置 highlight.js/lowlight 与 fast-diff，0.x                                    |
| react-diff-viewer-continued | 4.4.0 | MIT          | 324 KB / 109 KB                                            | emotion 运行时 CSS、refractor 高亮，依赖 diff 9.0.0（与仓库 8.0.4 重复）        |
| @pierre/diffs               | 1.5.2 | Apache-2.0   | 10.8 MB / 1.83 MB                                          | 用 shadow DOM 渲染（`attachShadow`），自带主题，依赖 diff 9.0.0 与 shiki 宽版本 |
| diff（已有）                | 8.0.4 | BSD-3-Clause | 8.2 KB / 3.1 KB（只取 `parsePatch`、`diffWordsWithSpace`） | 只计算，不渲染                                                                  |

决定：自研薄渲染层加 beUI `file-diff`。

- beUI `file-diff` 的 `FileDiffLine` 为 `{ id, type: "added" | "removed" | "context", oldLine, newLine, content }`，可以由 `parsePatch` 的 hunk 直接生成，适配成本低。它带折叠、+/− 计数、复制和流式状态，与 spec 中“工具调用默认折叠、点击展开 diff”一致。
- 需要改的源码：颜色从硬编码 `emerald`/`rose` 改为 `diff-*` token；高亮从组件内部 `useAgentCodeTokens(lines.join("\n"))` 改为外部传入 token，因为它把新增行与删除行拼成一段源码高亮，语法状态会错，应沿用 `diff-lines.ts` 的旧文、新文分开高亮；viewport 上的 `aria-live="polite"` 在流式期间会持续播报，应移除或只在完成时播报；英文文案进入 `@rukie/i18n`。
- `diff-lines.ts` 在 `coding-agent/src/view/` 中，依赖 `@rukie/shared` 与 `diff`，没有 Bun 或 Node 依赖，可被桌面端复用。它能否从 `packages/ui` 引用、还是移到共享位置，属于 [19: UI 包分层](../issues/19-ui-package-layering.md) 的问题。
- MVP 只做 unified。spec 没有要求 split 视图；TUI 的 split 对齐逻辑在 ink 层，以后需要时再按同样方式移植。
- 不升级 diff 到 9.0.0：本题不需要 9.x 的能力，升级会牵动 agent 与 coding-agent 两个包。

## 4. 代码高亮（shiki）

tech-stack 只写了 shiki，没有版本；npm `latest` 为 4.5.0（2026-10-01），shiki 仓库 13859 star，2026-10-01 推送，MIT。

实测体积（9 种语言静态导入，github-light + github-dark）：

| 组合                                                      | 产物                                   | gz           |
| --------------------------------------------------------- | -------------------------------------- | ------------ |
| `shiki/core` + JS 正则引擎 + `@shikijs/langs`             | 1 个文件 784.8 KB                      | 123.2 KB     |
| `shiki/core` + JS raw 引擎 + `@shikijs/langs-precompiled` | 1 个文件 756.6 KB                      | 111.8 KB     |
| `shiki/core` + Oniguruma 引擎 + `@shikijs/langs`          | 733.7 KB 入口 + 622.3 KB WASM chunk    | 336.7 KB     |
| 全量 `shiki` 的 `createHighlighter`（beUI 现状）          | 388 个 chunk 共 10.1 MB，入口 165.6 KB | 入口 52.0 KB |

实测首次高亮耗时（Node 24 / V8，一个 229 行 TS 文件，含两套主题）：

| 引擎                      | 创建 highlighter | 首次 `codeToTokens` | 第二次 |
| ------------------------- | ---------------- | ------------------- | ------ |
| JS 正则引擎（运行时转译） | 2 ms             | 181 ms              | 16 ms  |
| Oniguruma WASM            | 1 ms             | 125 ms              | 23 ms  |
| JS raw 引擎 + 预编译语法  | 1 ms             | 129 ms              | 未测   |

同样的脚本在 Bun（JSC）下首次耗时为 1076 ms、114 ms、667 ms，与 V8 差异很大，不能代表 Chromium renderer。Electron 41 中未实测。

集成方式：

- 位置：renderer。高亮结果只用于展示，main 与 sidecar 不参与，wire 协议也不需要携带 token。
- 引擎：JS raw 引擎配合 `@shikijs/langs-precompiled`。首次耗时与 WASM 相近，体积最小，不需要 `wasm-unsafe-eval` CSP。代价是预编译语法包 unpacked 8.5 MB（只影响安装和打包体积，按需导入的语言才会进入产物）。
- 语言：常用语言静态导入，其余按扩展名动态 `import("@shikijs/langs-precompiled/<id>")`，由 Vite 拆成 chunk，离线可用。未知扩展名回退为纯文本。
- 主题：`import githubLight from "@shikijs/themes/github-light"`、`github-dark`，与 DESIGN.md 的 GitHub Light/Dark 及其 “Code blocks and diffs highlighted by shiki use the `github-light` and `github-dark` themes” 一致。`codeToTokens(..., { themes: { light, dark }, defaultColor: false })` 实测每个 token 输出 `htmlStyle: { "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" }`，CSS 中按 `.dark` 选择变量即可，切换主题不需要重新高亮。
- 单例：整个 renderer 共享一个 highlighter，限制缓存大小。beUI `agent-code.tsx` 有两个问题。一是用全量 `createHighlighter` 且语言固定为 5 种，主题为 high-contrast。二是模块级 `tokenCache` 以“语言 + 完整代码”为键，永不淘汰；流式期间每次更新都会新增一项，长 Transcript 中内存只增不减。拷入后必须改为调用共享模块。
- 流式：`shiki-stream` 0.1.5 的仓库 antfu/shiki-stream 已归档，功能并入 `@shikijs/stream` 4.5.0（MIT，精确依赖 `@shikijs/core` 4.5.0，React peer `^19.0.0`）。它的 `ShikiStreamTokenizer.enqueue(chunk)` 返回 `stable`/`unstable`/`recall`，只重算不稳定的尾部。Markdown 渲染器在代码块未闭合时用它，闭合后改为整段高亮结果。`ShikiStreamRenderer` 要求 `ReadableStream`，与按 SessionEvent 增量更新的状态模型不匹配，不使用。
- 大输入：长文件或长输出的首次高亮可能超过一帧，阈值（按行数或字节）以上不高亮或放进 Worker，留给实现工单测量后决定。

## 5. 是否需要代码编辑器与交互式终端

不需要，MVP 只读展示即可。

- 编辑器：spec 中只有一个输入入口，是多行输入框（Enter 发送、Shift+Enter 换行、输入法组合时不发送），beUI `prompt-input` 已覆盖。spec 与 [03](../issues/03-mvp-scope.md#answer) 的最小闭环（选项目、新建或恢复 Session、流式对话、工具调用展示、权限 Interaction）中都没有打开或编辑文件。代码展示用 shiki，diff 用第 3 节的方案。CodeMirror（@uiw/react-codemirror 4.25.12，128.6 KB gz，实测）或 Monaco（monaco-editor 0.57.0，unpacked 101.7 MB）都没有使用场景。另外，codemirror/dev 仓库在 GitHub 上显示为已归档（2026-04-15 最后推送），而 `@codemirror/view` 仍在 2026-10-07 发布，维护位置需要以后再确认。
- 终端：Bash 工具没有 PTY，交互程序在 Agent Core 中本来就无法运行，桌面端加 xterm.js 不会改变这一点。工具输出是一次性的只读文本，第 2 节的 ANSI 渲染足够。会话菜单中的“在终端中打开”经 host 接口调用系统终端，不需要内嵌终端。
- 何时重新评估：桌面端增加文件编辑、内置终端面板，或 Agent Core 改用 PTY 时。届时 xterm.js 6.0.0 与 CodeMirror 6 是首选候选，Monaco 体积过大。

## 建议的 `docs/tech-stack.md` 条目

不在本工单中修改 tech-stack，以下条目供 spec 采纳时写入「界面」表：

| 用途          | 选型                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 长列表虚拟化  | @tanstack/react-virtual 3.14.14（精确依赖 @tanstack/virtual-core 3.18.0；需不低于 3.16.0 的 `anchorTo`/`followOnAppend`）                                    |
| 代码高亮      | shiki 4.5.0：renderer 内 `shiki/core` + `createJavaScriptRawEngine` + @shikijs/langs-precompiled 4.5.0，主题 `@shikijs/themes` 的 github-light / github-dark |
| 流式代码高亮  | @shikijs/stream 4.5.0                                                                                                                                        |
| 命令输出 ANSI | anser 2.3.5（只解析 SGR，React 渲染，不用 `innerHTML`）                                                                                                      |
| 文件 diff     | diff 8.0.4（已有）+ 自研 hunk→行适配 + beUI `file-diff`；不引入 diff 视图库                                                                                  |
| 编辑器与终端  | MVP 不引入                                                                                                                                                   |

「Markdown」行中的 “shiki/katex” 随之指向上表的 shiki 集成方式。

## 未验证

- 没有在 Electron 41 或 Vite 8 下构建与运行任何候选库；体积是 Bun 打包的结果，Vite（Rolldown）的产物会略有不同。
- TanStack 的流式增长、Turn 展开与 `scrollToIndex` 跳转行为只读了源码，没有在浏览器中测试，需要在实现工单的第一个 Transcript 原型中验证。
- shiki 耗时只测了一个文件、一台机器，Worker 方案未测。
- 没有用屏幕阅读器验证 `role="feed"` 方案和 beUI 组件的实际可访问性。
