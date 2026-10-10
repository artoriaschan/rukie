# 29: ui 对话流、工具调用、权限停靠卡与 Queued Input

**What to build:** 对话视图：SessionEvent 归约、虚拟化 Transcript、Turn 折叠与刻度、工具调用行（输出、ANSI、diff）、Markdown 与高亮、权限停靠卡、Queued Input 行、`session_busy` 提示与摘要卡片。见 [spec](../spec.md) 的「主窗口布局」中的主区域、工具调用与权限审批、输入框（Queued Input）。

Blocked by: 25, 28

Status: resolved

- [x] `store` 的 SessionEvent 归约（snapshot + 实时事件）用 Vitest Node 环境测试，含流式文本、工具开始与结束、中止与 Interaction
- [x] Transcript 按 Turn 用 `@tanstack/react-virtual` 虚拟化，底部跟随，上翻停止跟随，`role="feed"`；Turn 折叠、中止与当前 Turn 状态；Turn 刻度跳转与预览
- [x] 工具调用行：默认折叠、失败展开、`anser` ANSI 输出、`diff` 8.0.4 + 改造后的 `file-diff`（`diff-*` token、按行着色、流式不经 aria-live）
- [x] Markdown（micromark/mdast → React）与共享 shiki 高亮器（`shiki/core`、github-light/dark、`@shikijs/stream`，缓存有上限）
- [x] 权限停靠卡：Esc/A/↵、回复后 Turn 内结果行、`interaction_settled` 消失、`interaction_stale` 丢弃、断连禁用、重连补发后重新出现
- [x] Queued Input 行：立即发送与撤回；停止后按顺序以空行合并回填输入框草稿之前
- [x] `session_busy`：对话照常显示 snapshot，输入框替换为提示与「重试」
- [x] 摘要卡片：Todo 进度与子代理状态
- [x] 接缝同 28；GUI 浏览器验证中实测 TanStack 流式末行增高、Turn 展开与 `scrollToIndex`，并定下高亮跳过或移入 Worker 的输入阈值

## Implementation evidence

- 呈现按用户输入投影为 `PromptGroup`，组内保留多次原生 Turn，不改变 Core Turn 定义。`store/transcript` 归约 public SessionEvent；snapshot 是全量基准，message_end 是单 entry 的提交投影，按 entryId 更新或追加。原生 assistant entry + tool call ID 保留工具因果身份，复用 provider ID 不覆盖旧输出。
- 实际 fakeModel GUI 揭示早期 scripted fixture 将 message_end 错当全量列表，早期 focused pass 不覆盖原生增量。已改 fixture 与 reducer，覆盖恢复 snapshot 后追加、microtask 流式提交去重、用户/工具结果历史、重复 entry、中止、失败和复用工具 ID；原生 assistant stopReason/errorMessage 与失败 result 归约为失败状态及可见错误。
- App 接入 props-only Transcript / PermissionDock / QueuedInputs / Summary。布局与状态组合属于当前前端能力；Bubble、ToolResult、ToolApproval、FileDiff、TodoList、PreviewRail 和按钮继续使用 27 安装的 beUI 来源，专用库承担解析与虚拟化，无 TUI view 复用。
- Markdown 使用 mdast-util-from-markdown 内置 micromark，映射为 React 文本节点；HTML 与导航保持无执行能力。共享 Shiki core 使用 GitHub Light/Dark、预编译语法和 @shikijs/stream；语法引擎按需加载，完整块 LRU 上限 64。
- anser 解析标准/256 色/RGB SGR，剔除 OSC 与光标控制；diff 8.0.4 分离旧/新文 token 后传给改造后的 beUI FileDiff，工具输出无 aria-live。失败自动展开；工具未知结果与输出恢复提示在折叠之外可见。
- 审批按 epoch 捕获 PromptGroup、回复、命令和子代理来源，结果不依赖复用的 provider ID；主按钮获得焦点，菜单/IME/摘要避免焦点抢夺，原生 Deny 按钮 Enter 不误发 allow。断连卡片禁用，恢复连接清掉旧 epoch 并接受补发。
- 草稿/附件按 Session 与新会话草稿身份保存修订号；成功响应只清理未编辑的已提交版本，新会话创建期间的修改交接到新 Session 且不抢回其他会话选择。abort/withdraw 按发起 Session 回填，保留响应期间的草稿与图片。

## Verification evidence

- `bun run test:desktop`：14 个文件、45 项通过，5.38s；该 issue Node 3 项与 Chromium App 7 项覆盖原生增量、权限键盘/settled/stale/断连重放、steer/withdraw、停止回填归属、pending prompt 重输同值、新 Session 交接、摘要宽/窄布局与焦点、实际虚拟行测量，以及虚拟时钟耗时边界。7 项浏览器 focused 2.77s；单个浏览器场景所需真实 WS 子进程与 Chromium 布局测量属于接缝 3 集成成本，无固定等待。
- `bun run check:dev` 通过。`bunx --no vite build --config packages/ui/vite.config.ts packages/ui` 通过；主 chunk 864.25kB、按需语法引擎 959.38kB，仍有 Vite >500kB 的体积 warning，未弱化检查。
- 已执行 agent-browser CLI core 工作流与命名会话 desktop29，真实 startServer + 既有 fakeModel，隔离 HOME；开发模式与通过实际 serveAppFile 提供的生产 CSP 均验证。写入和 bash 两次权限默认焦点/Enter、最终回复折叠、diff 与 ANSI 展开、高亮 Light/Dark、480px 摘要全宽/Esc、持续真实 Session Run、刻度跳转与阅读位置均正常。生产 CSP 保持 script-src self、style-src self unsafe-inline，实际语法引擎成功加载；浏览器错误与 console error 为 0，代码/CSS/高亮引擎资源请求为 200；浏览器默认 favicon 请求为 404（本票不新增应用图标）。
- Chromium CLI 渲染实测：10 个回复组仅挂载 5 个 article；上翻至 scrollTop=0 后第 11 组追加仍为 0；scrollToIndex 跳至第 5 组，article y=45、scrollTop=1088；第一组展开从 272px 增至 448px；第 12 组流式末行从 104px 增至 256px，完成为 272px，最终底部 gap=0。自动浏览器同时覆盖 80 组只渲染少量行、流式大段增高、展开与 resize。
- Chrome 实测 TS 高亮 1/50/100/200 行分别约 3.3/5.7/7/13ms，201 行跳过（0ms）；阈值定为 200 行且 12,000 UTF-16 字符内同步高亮，超过显示纯文本，无 Worker。测量输入为普通 TS 对象声明，不宣称所有语法都有相同耗时。
- GUI 证据 `/tmp/rukie-desktop-evidence/issue29/`：permission-light.png、transcript-light.png、transcript-dark.png、transcript-narrow-light.png、transcript-narrow-dark.png、summary-narrow-dark.png、virtual-jump-expand-light.png、stream-measurements.json、highlight-measurements.json、browser-errors.txt、browser-console.txt、browser-network.txt、production-csp.txt、provider-error-light.png。浏览器会话、Vite、真实 server 与 CSP 资源服务已关闭；所有隔离 HOME 与 handshake credential 已清理。
- Provider failure 补验：最新 Node + Chromium focused 2 文件 10 项通过（2.69s），check:dev 通过；实际 fakeModel stopReason=error 在生产 CSP 页显示失败状态、Provider unavailable 警告，feed busy=false，浏览器错误为 0；补验服务、会话和 HOME 已关闭并清理。
- 完整聚合检查与独立代码审查由 spec 主线程统一完成，本票保持 claimed，未关闭 spec、未推送或声明远端 CI 通过。

- 已将当前集成基线 74a2aaa 合入本票分支（df617f46，无冲突），该树的 test:desktop 45 项通过（5.38s）及 check:dev 通过。随后仅收紧实际读取的 Transcript 身份/可选字段验证，非法 entryId 不进入呈现；Node store 两文件 9 项通过（215ms），check:dev 再通过，合法原生 GUI 行为未变。

## Answer

原生 Transcript、PromptGroup 虚拟化、Markdown/高亮/ANSI/diff、权限 Dock、队列和草稿所有权已完成；当前长刻度及 portal 预览修复通过实际 Electron hover/focus/键盘/窄窗口验收。

最终代码集成 `8af81b85`；独立双轴评审、后续修复、适用本地验证和 ADR Coverage 结论见 [spec 的交付证据](../spec.md#delivery-evidence)。本地工作已完成，最终推送的 CI 尚待验收；此状态不表示 PR 已合并。
