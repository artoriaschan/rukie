Status: claimed

# Spec: 桌面端 MVP

术语见 `CONTEXT.md` 的 Session、Run、Turn、Transcript、Interaction、Queued Input、Permission Mode、Background Job。规划过程与各项决定见 [地图](map.md)，每条决定的依据在对应工单的 `## Answer`。MVP 只支持 macOS arm64，本地编译 ad-hoc 签名的 `.app`，不接入 GitHub Actions（[03](issues/03-mvp-scope.md#comments)）。

## Problem Statement

Rukie 现在只能在终端里用：TUI 或 Headless CLI。用户想在桌面窗口里管理多个项目的 Session，看流式回复、工具调用和 diff，点按钮审批权限，而不必一直开着终端。桌面端还要和 TUI 共用同一份 Session，在终端里开始的工作能在窗口里接着做，反过来也一样。

## Solution

一个 macOS 桌面应用：Electron 窗口加一个 Bun sidecar。sidecar 里的本机 server 直接调用 Agent Core，渲染进程通过一条带鉴权的 WebSocket 和它通信。主窗口按 [09](issues/09-prototype-main-window.md#answer) 定稿的布局实现：左侧是项目与 Session 侧栏，中间是对话流，输入框上方停靠权限审批。Session 存在 TUI 使用的同一个 JSONL store 里。开发时可以在普通浏览器里打开渲染进程，直连本机 sidecar。用户在本机执行一条命令，就能构建出可直接打开的 `.app`。

## User Stories

### 项目与 Session

1. 作为用户，我想把本机的一个文件夹添加为项目，这样就能在里面运行 Session。
2. 作为用户，我想通过系统的文件夹选择框添加项目，不用手打路径。
3. 作为用户，我想在侧栏看到所有项目，以及每个项目下的 Session。
4. 作为用户，我想在不绑定项目的默认工作区里开始对话，用来处理和代码无关的问题。
5. 作为用户，我想在「对话」分组里看到默认工作区的 Session。
6. 作为用户，我想在「最近」分组里按更新时间看到全部 Session。
7. 作为用户，我想把「最近」改成按创建时间排序。
8. 作为用户，我想置顶常用的 Session，让它出现在「置顶」分组里。
9. 作为用户，我想取消置顶。
10. 作为用户，我想折叠或展开任意分组，以及单个项目文件夹。
11. 作为用户，我想一次展开或收起全部分组。
12. 作为用户，我想在侧栏的「显示」菜单里隐藏置顶、对话或项目分组。
13. 作为用户，我想在侧栏行上直接看到哪个 Session 正在运行、哪个在等我确认。
14. 作为用户，我想按住 Ctrl 看到 ⌃1–⌃9，并用它们跳到最近的 Session。
15. 作为用户，我想用 ⌘K 打开搜索浮层，按标题或项目名找到 Session。
16. 作为用户，我想用 ⌘N 新建对话。
17. 作为用户，我想在某个项目文件夹上直接新建 Session。
18. 作为用户，我想打开一个历史 Session，从它的 Transcript 接着对话。
19. 作为用户，我想在桌面端看到在 TUI 里创建的 Session，并能打开它们。
20. 作为用户，当一个 Session 正被 TUI 打开时，我想得到明确提示，而不是看到一个奇怪的报错。
21. 作为用户，我想通过会话更多菜单复制 Session ID、工作目录或 Markdown 形式的对话。
22. 作为用户，我想在 Finder 中显示，或在终端中打开 Session 的工作目录。

### 新会话与输入

23. 作为用户，我想在新会话欢迎页看到这个 Session 将在哪个项目里运行。
24. 作为用户，我想在发送前通过标题或位置条切换目标项目，或者改回默认工作区。
25. 作为用户，我想首次发送就创建 Session，不留下空 Session。
26. 作为用户，我想按 Enter 发送、Shift+Enter 换行，用输入法组合输入时不会误发。
27. 作为用户，我想在消息里附带图片。
28. 作为用户，我想从输入框切换 Permission Mode，并看到每个模式的说明。
29. 作为用户，我想 `full-access` 模式有醒目的颜色，避免误开。
30. 作为用户，我想从输入框切换模型和推理档次，并看到模型的输入类型和上下文窗口。
31. 作为用户，我想看到上下文用量环，点开能看到系统、工具、消息各占多少，以及压缩点在哪。
32. 作为用户，我想在 Run 运行中继续输入，这条消息作为 Queued Input 等当前 Run 停止调用工具后再放进对话。
33. 作为用户，我想看到已排队的 Queued Input，并能对其中一条「立即发送」或撤回。
34. 作为用户，我想在 Run 运行中、输入框为空时点停止。
35. 作为用户，停止后我想让所有排队的输入回到输入框，一条都不丢。

### 对话阅读

36. 作为用户，我想看到模型回复流式出现。
37. 作为用户，我想看到右对齐的用户消息气泡。
38. 作为用户，我想让已完成的 Turn 折叠起来，只显示最终回复和耗时，需要时再展开看全部步骤。
39. 作为用户，我想让当前 Turn 完整展开，并显示已运行多久。
40. 作为用户，我想看出某个 Turn 是被我中止的。
41. 作为用户，我想把工具调用看成一行：工具图标、动作名、命令或路径。
42. 作为用户，我想点开一行工具调用，看它的输出或 diff。
43. 作为用户，我想让失败的工具调用自动展开输出。
44. 作为用户，我想在命令输出里看到原有的终端颜色。
45. 作为用户，我想用按行着色的 diff 看文件改动。
46. 作为用户，我想看到渲染好的 Markdown，代码块按 GitHub 主题高亮。
47. 作为用户，我想在很长的对话里滚动时依然流畅。
48. 作为用户，我想在新内容到达时一直跟随到底部，往上翻时停止跟随。
49. 作为用户，我想用左缘的 Turn 刻度跳到某个 Turn，悬停时预览它的问题和最后回复。
50. 作为用户，我想打开会话摘要卡片，看 Todo 进度和子代理状态。

### 权限 Interaction

51. 作为用户，我想在输入框上方看到待确认的权限请求：工具、命令和原因。
52. 作为用户，我想用 Esc 拒绝、A 本会话内允许、Enter 允许。
53. 作为用户，回复后我想在 Turn 里留下一行记录，说明我做了什么决定。
54. 作为用户，重连后我想让还没回复的权限请求重新出现。
55. 作为用户，当请求已被取消或被会话规则覆盖时，我想让卡片自动消失。
56. 作为用户，断连期间我不想误点回复按钮。

### 连接与进程

57. 作为用户，我想在 sidecar 重连时看到「正在重新连接」。
58. 作为用户，连接断开时我想看到提示和「重试」按钮。
59. 作为用户，我想知道断连期间 Run 仍在 sidecar 里继续，重连后会补齐消息。
60. 作为用户，sidecar 意外退出时我想让它自动重启一次，Session 照常可用。
61. 作为用户，退出应用时我想让 Run 和后台命令被干净地停止。
62. 作为用户，我想让本机其他网页或进程无法连上我的 sidecar。

### 外观与可访问性

63. 作为用户，我想让应用跟随系统的浅色或深色模式。
64. 作为用户，我想用中文或英文界面。
65. 作为键盘用户，我想用键盘操作每个按钮、菜单和浮层，并看到清楚的焦点。
66. 作为读屏用户，我想让纯图标按钮有可读的名称。
67. 作为开启了减少动态效果的用户，我想让动画停下或只保留淡入淡出。
68. 作为窄窗口用户，我想让侧栏浮在主区域之上，核心流程照常可用。

### 开发与构建

69. 作为开发者，我想在普通浏览器里打开渲染进程，连接本机 sidecar 调试界面。
70. 作为开发者，我想运行一条本地测试命令，覆盖 ui 与 desktop 的 Vitest 测试。
71. 作为开发者，我想让 `bun test` 和 CI 分片不收集 Vitest 文件。
72. 作为开发者，我想运行一条命令构建出 ad-hoc 签名的 `.app`，它能在本机直接打开。
73. 作为开发者，我想让构建脚本在 sidecar 丢失 JIT 时直接失败，不要等到运行时才发现慢了很多。
74. 作为开发者，我想让 lint 拦住越层导入和非 `text-ui-*` 字号。

## Implementation Decisions

### 包结构

- 新增三个 workspace 包：`@rukie/ui`（React DOM 界面）、`@rukie/server`（Bun 本机 server，Agent Core 的网络 frontend）、`@rukie/desktop`（Electron main、preload、sidecar 管理与打包；渲染进程的 Vite 入口同时用作浏览器开发模式）。不建 `packages/web`（[01](issues/01-packages-and-effect-boundary.md#answer)）。
- GUI 不复用 `coding-agent/src/view/`，跨端只共享 `@rukie/shared` 里的协议类型。这部分替代 ADR-0012 中「view 抽成 UI 包」的说法（[ADR-0029](../../docs/adr/0029-desktop-package-structure.md)）。
- `@rukie/ui` 分五层，只能向下依赖（[19](issues/19-ui-package-layering.md#answer)）：
  - `app`：屏幕装配，唯一的接线层。
  - `components`：React 组件，只通过 props 拿数据。
  - `store`：Zustand store，以及把 wire 消息归约成 UI 状态的纯函数，不依赖 React。
  - `client`：WS wire client，负责连接、重连、请求 `id` 关联、订阅与补发，不依赖 React 和 Zustand。
  - `host`：只定义接口，由入口注入实现。

  依赖方向是 `app → components / store → client → @rukie/shared`。`host` 只被 `app` 和 `client` 使用。

- ui 只用 `import type` 引入 `@rukie/agent` 的具体事件类型。不允许导入 `@rukie/coding-agent`、`electron`，以及 Node 或 Bun 的 API。这些边界由 `.oxlintrc.json` 中按目录配置的 `no-restricted-imports` 强制。
- ui 内重写 SessionEvent 归约、diff 行拆分（基于 `diff` 8.0.4）和 Markdown 渲染（micromark/mdast 解析后输出 React），与 TUI 的实现各自测试。
- ui 的 zh/en 字典放在 ui 包内，用 `@rukie/i18n` 解析 locale 和插值。wire 错误码的文案也在 ui 字典里，按 code 查找。

### server

- Hono 负责 HTTP 与 WebSocket 接入、中间件和校验。Effect 4.0.2 只在 server 内部做业务编排、依赖注入、错误与资源生命周期，不越过 server 边界：Agent Core 和 ui 都不依赖 effect（[01](issues/01-packages-and-effect-boundary.md#answer)、[04](issues/04-research-effect-on-bun.md#answer)、[ADR-0030](../../docs/adr/0030-desktop-server-hono-and-effect.md)）。暂不引入 `@effect/platform-bun`。
- 整个进程只有一个 `ManagedRuntime`，Agent Core、注册表和 Run registry 以 Layer 注入。Run 存在 server 级的 `FiberMap` 里，按 Session 区分：WS 关闭不会中断 Run，abort 命令会移除对应 Fiber，graceful shutdown 时释放整个 runtime。
- 直接 import `@rukie/agent`，按 Session 传入 `cwd` 和 `homeDir`。server 按 Session id 单飞打开，在订阅者之间共享同一个 Session，并传入 `onWarning` 接入 server 日志（[12](issues/12-research-agent-core-in-server.md#answer)）。
- Interaction 桥接：server 给 `createSession` 提供 `onPermissionAsk` 回调，挂起的 Promise 存在按 `InteractionIdentity.epoch` 索引的 pending 表里。MVP 只桥接权限 Interaction，其余回调省略，依赖它们的工具保持隐藏。
- Session 生命周期：有 Run、挂起的 Interaction、排队的输入或运行中的 Background Job 时，Session 保持打开。空闲且没有订阅超过 10 分钟后才 `close()`，释放 lease。连接断开不触发关闭。
- 收到 SIGTERM 时，server 关闭所有打开的 Session（这会清理 Background Job 进程组），然后退出（[18](issues/18-orphan-background-jobs.md#answer)）。
- 桌面端注册表放在 `homeDir/.rukie/desktop/registry.json`，由 server 独占读写：项目列表（绝对路径和显示名）、置顶的 Session id，以及侧栏的排序与分组显示偏好。默认工作区目录是 `homeDir/.rukie/desktop/workspace/`，首次使用时创建。Agent Core 和 store 的格式不变（[10](issues/10-wire-protocol-messages.md#answer)、[ADR-0032](../../docs/adr/0032-desktop-shares-jsonl-store.md)）。
- 列举 Session 时，对每个注册的 cwd 调用 `listSessions`，单个目录失败不影响其他目录。

### wire 协议与鉴权

协议细节见 [10](issues/10-wire-protocol-messages.md#answer)，决定记录在 [ADR-0031](../../docs/adr/0031-desktop-wire-protocol-and-local-auth.md)。

- 每个窗口一条 WS，多个 Session 按 `sessionId` 复用，客户端显式 `session.subscribe` / `session.unsubscribe`。订阅时，server 先发 snapshot，再补发挂起的 Interaction，然后转发实时事件。同一时间只有一条活跃连接：新连接接管，旧连接以 `superseded` 关闭。
- 所有命令走 WS：客户端消息带 `id`，server 回 `{type:"response", id, result}` 或 `{type:"response", id, error:{code, params?}}`。客户端命令是不可信输入，以 TypeBox 定义在 `@rukie/shared`，由 server 校验。server 发给客户端的消息只用 TS 类型：SessionEvent 原样转发，server 自有的消息是 `response`、`interaction_requested`、`interaction_settled`、`sessions_changed`。Headless stream-json 不变。
- MVP 命令：`projects.list`、`project.add {path}`、`sessions.list`、`session.create {project, text, images?}`、`session.subscribe`、`session.unsubscribe`、`prompt {sessionId, text, images?}`、`steer_now {sessionId, requestId}`、`withdraw {sessionId, requestId}`、`abort {sessionId}`、`session.pin`、`session.unpin`、`models.list`、`session.set_model`、`session.set_permission_mode`、`interaction.reply {identity, reply}`，以及保存侧栏偏好的 `preferences.set`。
- 错误码：`session_busy`、`session_not_found`、`project_not_found`、`invalid_command`、`not_queued`、`interaction_stale`、`internal`。Run 内部的错误仍然通过 SessionEvent 的 `result` / `error` 送达。
- 鉴权（[06](issues/06-research-local-server-auth.md#answer)、[16](issues/16-research-electron-app-scheme.md#answer)）：
  - server 只监听 `127.0.0.1` 的随机端口，启动时生成一次性 token，在 stdout 输出 `{port, token}` 握手。
  - 客户端以 `new WebSocket(url, ["rukie.v1", "rukie.auth." + token])` 连接。
  - 升级前的中间件精确校验 Host（`127.0.0.1:<port>`）、Origin 白名单和 token（`timingSafeEqual`）。生产 Origin 为 `app://rukie`；sidecar 以开发标志启动时，额外放行 Vite 开发地址。

### 渲染进程能力（host）

host 接口只有四个方法：`getConnection()`、`pickProjectFolder()`、`revealPath(path)`、`openInTerminal(path)`。

- **Electron**：preload 经 `contextBridge` 暴露这四个方法，main 校验调用来自 `app://rukie`。sidecar 重启后，端口和 token 都会变，renderer 每次重连都重新获取。
- **浏览器开发模式**：
  - 连接信息从 URL fragment `#token=` 读取，读取后用 `history.replaceState` 清除；
  - 选择文件夹改为手动输入路径；
  - 后两个方法不可用，对应菜单项隐藏。
- 主题跟随系统，用 CSS `prefers-color-scheme` 实现，不经过 host。

### desktop main 与 sidecar

- **`app://rukie` 的注册与文件服务**（[16](issues/16-research-electron-app-scheme.md#answer)）：
  - `ready` 前注册 `app` scheme，只开 standard、secure、supportFetchAPI 三项权限；
  - `loadURL` 前，在窗口使用的 session 上调用 `protocol.handle`；
  - handler 只接受 host `rukie`，路径解码后再检查是否越界，没有扩展名的路径回退到 `index.html`，显式设置 content-type，HTML 响应附带 CSP。
- **CSP**：`connect-src` 为 `ws://127.0.0.1:*`，这样 sidecar 换端口后不必重新加载页面。`style-src` 是否需要 `'unsafe-inline'` 或 nonce，以真实 Vite + beUI 构建产物的实测为准。
- **启动 sidecar**：main 剔除 `BUN_BE_BUN`、`BUN_OPTIONS`、`DYLD_*`、`NODE_OPTIONS` 后再启动，读取 stdout 握手，10 秒内没有握手就判定失败（[11](issues/11-research-sidecar-packaging.md#answer)）。
- **停止 sidecar**（退出应用、无响应、崩溃后重启前）：一律先发 SIGTERM，5 秒后还没退出再发 SIGKILL。sidecar 意外退出时，main 通知 renderer 并自动重启一次；第二次退出后不再重启，renderer 显示「连接已断开」，由「重试」手动重启（[02](issues/02-connection-and-process-semantics.md#answer)、[18](issues/18-orphan-background-jobs.md#answer)）。
- **窗口关闭**时，desktop 对仍在运行的 Run 显式 abort。

### 本地 macOS 构建

细节见 [17](issues/17-research-packaging-details.md#answer)。

- **编译 sidecar**：用 `bun build --compile` 编译成单文件，编译时注入 `RUKIE_COMPILED=true`，并加上 `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`。编译设置和 `scripts/release/build.ts` 共用。
- **资源布局**：sidecar 和锁定版本的 `@vscode/ripgrep-darwin-arm64` 提供的 `rg` 一起经 `extraResources` 放到 `Contents/Resources/sidecar/`，不进 asar。grep 工具沿用「可执行文件同目录」的查找方式。编译版找不到 ripgrep 时，报错文案不再提 npm optionalDependencies。
- **签名**：electron-builder 设 `mac.identity: "-"`，对整个 app 做 ad-hoc 签名并开启 hardened runtime。Electron 的 entitlements 保留 `disable-library-validation`。`afterSign` 再单独处理两个文件：sidecar 只带 `com.apple.security.cs.allow-jit`，`rg` 不带 entitlement，最后重新封装整个 app。
- **构建脚本检查**：
  - `codesign --verify --deep --strict` 通过；
  - 用 `BUN_BE_BUN=1` 在打包后的 sidecar 里断言 JIT 生效（`numberOfDFGCompiles` 不等于 1000000）；
  - 不运行 `spctl`，因为它会拒绝所有 ad-hoc 构建。
- **fuses**：用 `@electron/fuses` 2.0.0 在 `afterPack` 里调用，`loadFile` / `file://` 不可用。打开 asar 完整性 fuse 之前，要先确认 electron-builder 26.15.3 会写入 `ElectronAsarIntegrity`；没有写入的话，这个 fuse 就不开。
- 构建只能在本地运行，不接入 GitHub Actions。

### 界面组件与外观

- **组件来源**（[15](issues/15-research-beui-install.md#answer)）：按钮、tooltip、popover、命令面板、模态框、select 和 Agent 执行反馈用 beUI，经 shadcn CLI 4.21.4 安装。带子菜单的点击菜单（会话、项目、账户、权限模式、模型）用 shadcn `dropdown-menu` 补位，浮层表面要和 beUI 保持一致。安装后手动修正 CLI 把 `@/lib/text-shimmer` 改成自引用的问题，删除 CLI 加入的 `cn` 包和 Geist 字体，所有依赖都锁定精确版本。
- **主题与字号**：主题 CSS 以 beUI `theme.css` 为模板，换成 DESIGN.md 的 GitHub Light/Dark 取值；`--glass-*` 和 `--neon` 只改值，不改名。`text-ui-*` 定义在 `@theme inline` 里。`cn()` 必须用 `extendTailwindMerge`，否则 `text-ui-sm` 和颜色类合并时会被静默删掉；shadcn 组件改为引用这个 `cn()`。
- **拷入后的改写**：约 100 处字号类改为 `text-ui-*`，约 90 条硬编码英文文案进 zh/en 字典，68 处硬编码 `emerald/rose/blue/amber` 改成状态 token 或 `diff-*` token。lint 拦截非 `text-ui-*` 字号：用 `scripts/check-*.ts` 正则检查，接入 `check:dev`，不用 alpha 状态的 oxlint jsPlugins。
- **专用库**（[14](issues/14-research-specialized-libraries.md#answer)）：
  - Transcript 按 Turn 用 `@tanstack/react-virtual` 3.14.14 虚拟化，锚定底部并在追加时跟随；
  - 命令输出用 `anser` 2.3.5 解析 SGR 颜色，再由 React 渲染；
  - diff 由 `diff` 8.0.4 计算，用改造后的 beUI `file-diff` 显示（`diff-*` token、按行着色，流式更新时不经 aria-live 播报）；
  - 代码高亮用 shiki 4.5.0 的 `shiki/core`，配合 JS 正则引擎、预编译语言包和 github-light/dark 主题，流式高亮用 `@shikijs/stream`。全应用共用一个高亮器，token 缓存有上限。
  - beUI `tool-result` 的输出区换成 ANSI 渲染。
  - MVP 不做代码编辑器，也不做交互式终端。
- **DESIGN.md 与 tech-stack 修订**：
  - 记录 `dropdown-menu` 补位；
  - 重写「glass 表面保留」一句，因为实际安装的组件并未使用 glass 类；
  - 允许 beUI 自带的 `foreground` alpha 填充，只用于 hover、选中这类交互底色；
  - 补充 `ansi-*` 颜色 token、`text-[11px]` / `text-[13px]` 对应的字号与行高；
  - 更新版本：lucide-react 1.55.0、vitest 5.0.3。

### 主窗口布局

原型保存在 `origin/prototype/desktop-main-window`（HEAD `ba40fd5d`），是布局与交互的原始资料：在 `prototypes/desktop-main-window/` 下执行 `npm install && npm run dev`，打开 `http://localhost:5199/`，可用 `?theme=light|dark&lang=zh|en&conn=connected|reconnecting|disconnected` 切换。原型是手写的 shadcn 风格组件，正式实现按上一节选取组件，外观按 [DESIGN.md](../../DESIGN.md)。快捷键、交通灯和 Finder 只按 macOS 设计。

#### 窗口外壳

- 窗口底色（`card`）承载通栏标题栏与左侧导航栏。侧栏和主区域合成一张 `background` 底的内容面板，只有左上角圆角，以一条 border 与窗口底色分界；侧栏和主区域之间有一条竖线，与标题栏分隔线对齐。
- 标题栏左侧：交通灯占位、侧栏开关。右侧：类型图标（项目为文件夹，默认工作区为对话图标，tooltip 显示项目名或「对话」）、Session 标题、更多菜单、摘要开关。标题栏可以拖动窗口，控件区不可拖动。
- 导航栏只有「首页」：选中时为实心图标加浅色圆角底块，标签在 tooltip 里。MVP 不显示头像和账户菜单。
- 窄窗口下侧栏浮在主区域之上，侧栏内容不变。

#### 侧栏

- 顶部是「新聊天」（⌘N），右侧是搜索按钮。点搜索按钮或按 ⌘K 打开居中命令浮层，侧栏收起时也能用：
  - 空查询列出最近 8 个 Session，输入后按标题或项目名过滤；
  - ↑↓ 选择，Enter 打开；Esc 或点击遮罩关闭，焦点还给打开者。
- 下面是四个可折叠分组：
  - 置顶：pinned Session。
  - 对话：默认工作区里的 Session。
  - 项目：按注册的项目目录分组，文件夹可以单独折叠，只用文件夹图标表示展开状态。hover 时出现「在该项目中新建会话」。
  - 最近：全部 Session，按更新时间倒序。
- 同一个 Session 可以同时出现在多个分组里。按住 Ctrl 时显示 ⌃1–⌃9，编号按「最近」的顺序。
- 分组标题的折叠箭头和操作图标只在 hover 或获得焦点时出现，菜单打开期间保持可见。「最近」标题右侧有两个入口：
  - 更多菜单：整理侧边栏（展开全部 / 收起全部）、会话排序方式（按更新时间 / 按创建时间）、「显示」下的置顶、对话、项目勾选项；
  - 新会话按钮。

  排序同时决定「最近」的顺序和 ⌃ 编号。这些偏好写进桌面端注册表。

- 会话行只显示标题和状态：运行中显示转圈，等待权限确认显示 warning 色圆点，不显示时间。hover 时显示置顶 / 取消置顶。

#### 主区域

- 新会话显示欢迎页和输入框。项目内的标题是「你想让我们在 {项目} 中构建什么？」，默认工作区是「今天想聊点什么？」。标题里的项目名和输入框上方的位置条都能切换目标。首次发送即创建 Session，并切到它的对话视图。
- 历史会话显示对话和输入框，对话列居中，最大宽度 `max-w-3xl`。
- 用户消息是右对齐的气泡。Turn 有三种显示方式：
  - 已完成的 Turn 折叠在「用时 {时间}」分隔线后，只显示最终回复，点击展开全部步骤；
  - 用户中止的 Turn 显示「你在 {时间} 后停止了」，保持展开；
  - 当前 Turn 完整展开，顶部显示「正在执行 · {时间}」，等待确认时显示「等待确认」。
- 左缘是 Turn 刻度，两个 Turn 以上才显示，窄窗口下隐藏。当前 Turn 的刻度加长，点击跳转，hover 或聚焦时显示该 Turn 的问题和最后回复。
- Session 被其他进程占用（`session_busy`）时，对话区照常显示 snapshot，输入框替换为一条提示：这个 Session 正在别处打开，关闭后再试，旁边有「重试」按钮。
- 会话摘要卡片由标题栏的摘要开关切换，固定在对话区右上角，滚动时不动，不抢焦点，Esc 关闭。MVP 只显示 Todo 进度和子代理状态，两者都能从 Transcript 推导出来。宽窗口下打开时，对话列让出位置；窄窗口下覆盖全宽。

#### 工具调用与权限审批

- 工具调用显示为一行：工具图标、动作名（如「运行了命令」）、等宽字体的标题（命令或路径）。运行中显示转圈，失败显示 danger 图标。默认折叠，点击展开输出或 diff；失败的调用直接展开输出。
- 待处理的权限 Interaction 停靠在输入框上方，不嵌在 Turn 里：
  - 内容：标题「{工具} 需要你的确认」、等宽字体的命令、原因；
  - 按钮：「拒绝 Esc」「本会话内允许 A」「允许 ↵」，分别对应 `deny`、`allow-session`、`allow`。「允许」是主按钮，默认获得焦点。
  - 回复后卡片消失，Turn 里留一行结果（图标、回复、命令）。
- 断连或重连期间，回复按钮禁用。重连订阅时 server 补发挂起的 Interaction，停靠卡重新出现。收到 `interaction_settled` 时卡片直接消失；回复已过期（`interaction_stale`）时丢弃。

#### 输入框

- 输入框是一张圆角卡片：多行输入，Enter 发送，Shift+Enter 换行，输入法组合时不发送。左侧是附件（只支持图片）和权限模式菜单，右侧是上下文用量环、模型选择、发送或停止。
- 权限模式菜单每项都带说明（`ask` / `auto-review` / `full-access`），`full-access` 用 warning 色。
- 上下文用量环按已用比例填充，点击打开用量面板：系统 / 工具 / 消息的分段条、开场上下文、压缩点，不显示估计费用。
- 模型列表里 hover 或聚焦某一行时，旁边显示该模型的详情：输入类型、上下文窗口、推理档次。档次取 Agent Core `THINKING_LEVELS` 里该模型支持的子集，选档会同时选中这个模型。
- Run 运行中按 Enter 发出的是 Queued Input：
  - 它在当前 Run 停止调用工具后才放进对话；
  - 排队中的每一条显示在输入框上方、停靠卡下方，一条一行，附带「立即发送」（`steer_now`）和撤回（`withdraw`）按钮；
  - 输入框为空时按钮是停止。停止会撤回全部 Queued Input，按排队顺序以空行合并，放在输入框草稿之前。

#### 断开与重连

- 连接状态显示在输入框上方：重连中是转圈加「正在重新连接…」，已断开是断网图标加「连接已断开」和「重试」按钮。两种状态都说明 Run 仍在 sidecar 里继续，重连后会补齐消息和待确认项。
- 断连期间不能发送，权限回复按钮禁用。

#### 菜单与 tooltip

- 标题栏的会话更多菜单：置顶（⌥⌘P）、复制（Session ID、工作目录、Markdown）、打开方式（在 Finder 中显示、在终端中打开）。
- 菜单用门户渲染，在视口内自动翻转，支持方向键、Home、End、→ ←、Esc；用指针打开的菜单也能按 Esc 关闭。
- 所有纯图标按钮都有 tooltip 和可访问名称；导航栏的 tooltip 显示在右侧。

#### 相对原型的删减

以下原型入口在 MVP 里不做：

- 账户菜单（使用情况、设置），因为 MVP 没有设置界面；
- 会话菜单里的重命名、归档、永久删除；
- 项目更多菜单（置顶、编辑、归档聊天、移除项目）和「新建分区」；
- 摘要卡片里的分支、变更文件与来源，它们需要 server 提供工作区信息；
- 文件附件。

此外，Pencil 稿里的 Codex/ChatGPT 文案、模型倍率和估计费用都不纳入。

### Agent Core 前置改动

- store 在 lease 被占用时抛出的 `Session already open` 改为带 code 的 user-visible error，含 zh/en 文案，server 据此映射成 `session_busy`（[05](issues/05-research-store-lease-concurrency.md#answer)）。
- `listSessions` 按目录容错：单个 Session 的索引读取失败时跳过，通过 `onWarning` 上报，不让整个列举失败。
- 公开 Queued Input：
  - `followUp(prompt, {images?})` 返回 `requestId`；
  - 可以按 `requestId` 撤回，基于 pi `submissions.abort` 实现；
  - 撤回与 abort 的结果都带回原文和附件。
- 孤儿 Background Job 不回收，Agent Core 不持久化 pgid（[18](issues/18-orphan-background-jobs.md#answer)）。

## Testing Decisions

- 只测外部可观察的行为：wire 消息、渲染出的 DOM 与可访问名称、进程退出状态、构建产物，不测内部函数调用。测试分层遵循 [docs/testing.md](../../docs/testing.md)，测试工具按 ADR-0004 选。
- 唯一的模型替身是 `fakeModel`。它包装了 pi-ai 1.0.4 的 `fauxProvider`（pi 官方的脚本化内存 provider），server 测试沿用 Agent Core 现有的这个 helper，不另造模型替身。ui 测试不经过模型。
- 接缝：
  1. **Agent Core**：`createSession` 加 `fakeModel`，覆盖 busy 错误码、`listSessions` 容错、Queued Input 的放入、`steer_now`、撤回与 abort 回填。先例：`packages/agent/tests/e2e/` 里的 Session 与恢复用例。
  2. **server**：在测试进程内启动 server，用真实的 WS 客户端和 `fakeModel`，覆盖握手鉴权（Host、Origin、token 的各种拒绝情况）、全部 MVP 命令、订阅时的 snapshot 与 Interaction 补发、新连接接管、断连后 Run 继续、空闲关闭、SIGTERM 关闭 Session、错误码。宽限期计时用虚拟时钟。用 `bun:test`。
  3. **ui**：Vitest browser mode（`@vitest/browser-playwright` + Chromium headless shell + `vitest-browser-react`）渲染 `app`，连接一个按 `@rukie/shared` 协议回放脚本消息的测试 WS server。覆盖侧栏、新会话、流式对话、工具行、权限停靠卡、Queued Input、断连与重连、`session_busy`、键盘与焦点、窄窗口。`store/` 和 `client/` 用 Vitest Node 环境单独测归约和重连。这里不经过真实的 Agent Core，端到端的正确性由接缝 2 保证。
  4. **desktop main**：Vitest Node 环境加 `vi.mock("electron")`，驱动一个假的 sidecar 脚本，覆盖握手超时、环境变量剔除、SIGTERM 加宽限期后 SIGKILL、只自动重启一次、`app://` handler 的越界与回退、preload 的来源校验。
  5. **本地构建**：构建脚本自身的断言（`codesign --verify --deep --strict`、JIT 检查、资源布局）作为验收，手动在本机运行，不进测试套件。
- 接入：
  - 根目录 `bunfig.toml` 用 `pathIgnorePatterns` 排除 ui 和 desktop，`bun test` 和 CI 分片都不会收集 Vitest 文件；
  - 新增 `test:desktop`，只加进本地的 `check`，不加进 CI 运行的 `check:dev`；
  - `check:test-policy` 增加 runner 边界：ui/desktop 不允许导入 `bun:test`，其他包不允许导入 `vitest`；
  - 涉及 ui/desktop 的 PR 必须在交付证据里附上本地 `test:desktop` 的运行结果。这条规则同步写进 AGENTS.md 和 docs/testing.md。
- 版本：vitest 5.0.3、@vitest/browser-playwright 5.0.3、playwright 1.64.0、vitest-browser-react 2.3.0。本地需要先执行 `playwright install --only-shell chromium`，不放进 postinstall。
- GUI 浏览器验证：每个 UI 工单在测试和静态检查通过后，按 AGENTS.md 用 `agent-browser` 检查 Light/Dark 和窄窗口，同时实测 CSP `style-src`、popover 滤镜性能、TanStack 流式末行增高、Turn 展开与 `scrollToIndex`，以及高亮的输入大小阈值。

## Out of Scope

- Web 产品（远程访问、部署、多用户认证）。
- Agent Core 迁移到 Effect。
- Windows、Linux、macOS x64 与 universal 构建，Developer ID 签名、公证、Windows 签名，自动更新。
- 桌面端接入 GitHub Actions。
- 桌面设置界面，以及 MVP 之外的 TUI 对等能力：Plan Mode、Rewind、Background Jobs 视图、MCP 面板、Goal、slash commands、Question 与 MCP 授权 Interaction。
- 重命名、归档、删除 Session，项目菜单，侧栏分区。
- 代码编辑器、交互式终端、会话内搜索。
- 回收孤儿 Background Job。

## Further Notes

- **已知限制**：
  - sidecar 被 SIGKILL 或崩溃时，Background Job 进程组会成为孤儿，重启后不会回收，也不会提示。TUI 被 SIGKILL 时同样如此。
  - 虚拟列表里屏幕外的 Turn，读屏软件读不到，Electron 的页内查找也搜不到；Transcript 容器用 `role="feed"`，会话内搜索留给后续 effort。
  - Playwright 的 Chromium（156）和 Electron 41.0.3 内置的 Chromium（146）版本不同，browser mode 测试不能代替 Electron renderer 的验证。
- **ad-hoc 签名**：
  - 本地构建产物没有 quarantine 属性，可以直接打开；拷到别的机器上，或经浏览器下载后会被 Gatekeeper 拦截。
  - ad-hoc 签名的 `.app` 启动时会打印一条「Keychain lookup failed」，不影响功能。
- 实现工单见 `issues/21` 到 `issues/30`。

## ADR Coverage

| 决定或修改                                                        | 归属                                                                                                                                       | 理由                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 新建 ui/server/desktop 三包，GUI 不复用 `view/`                   | 新增 [ADR-0029](../../docs/adr/0029-desktop-package-structure.md)，部分替代 [ADR-0012](../../docs/adr/0012-single-coding-agent-package.md) | 推翻「view 抽成 UI 包」，包边界难以逆转                      |
| ui 五层与 lint 边界                                               | 新增 [ADR-0029](../../docs/adr/0029-desktop-package-structure.md)                                                                          | 与包结构同一取舍，单向依赖由 oxlint 强制                     |
| Hono 接入、Effect 只在 server 内                                  | 新增 [ADR-0030](../../docs/adr/0030-desktop-server-hono-and-effect.md)                                                                     | 仓库唯一使用 Effect 的包，缺上下文会意外                     |
| 单 WS 复用、TypeBox 命令、epoch 关联、本机鉴权                    | 新增 [ADR-0031](../../docs/adr/0031-desktop-wire-protocol-and-local-auth.md)                                                               | 协议契约与安全边界                                           |
| 与 TUI 共用 JSONL store、桌面端注册表                             | 新增 [ADR-0032](../../docs/adr/0032-desktop-shares-jsonl-store.md)，整份替代 [ADR-0003](../../docs/adr/0003-dual-session-store.md)         | 推翻「桌面端用 SQLite」                                      |
| Agent 在 Bun sidecar，sidecar 单文件编译放在 `Resources/sidecar/` | 沿用并更新 [ADR-0001](../../docs/adr/0001-agent-runs-in-bun-sidecar.md) 的事实                                                             | 决定不变，补充实现形态                                       |
| Vitest browser mode、`bunfig.toml` 排除、本地 `test:desktop`      | 沿用并更新 [ADR-0004](../../docs/adr/0004-test-runner-per-runtime.md) 的事实                                                               | runner 按运行时划分不变，补充接入方式                        |
| Durable 执行、lease 与恢复                                        | 沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)                                                                           | server 直接调用 Agent Core，不改变执行与持久化语义           |
| Agent Core 前置改动的模块归属                                     | 沿用 [ADR-0011](../../docs/adr/0011-agent-module-ownership.md)                                                                             | busy 错误归 store，Queued Input 归 Session，不新增跨能力依赖 |
| zh/en 字典在 ui 包内                                              | 沿用 [ADR-0008](../../docs/adr/0008-locale-agnostic-agent-core.md)                                                                         | Agent Core 保持 locale 无关，frontend 自带字典               |
| 只支持 macOS arm64、本地 ad-hoc 构建、不接 CI                     | 无需 ADR                                                                                                                                   | effort 范围限定，记在 03 与本 spec，扩大平台时再立 ADR       |
| 孤儿 Background Job 作为已知限制                                  | 无需 ADR                                                                                                                                   | 维持现有语义，日后补回收不难逆转                             |
| 签名、fuses、JIT 检查细节                                         | 无需 ADR                                                                                                                                   | 构建配置，随工具版本调整                                     |
| 专用库与 beUI 安装方式                                            | 无需 ADR                                                                                                                                   | 依赖选型记在 tech-stack 与 DESIGN.md，可替换                 |
