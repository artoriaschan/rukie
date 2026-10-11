# Desktop app wayfinding map

## Destination

桌面端 MVP 的 `spec.md` 与实现工单：架构、包边界、wire 协议、sidecar 生命周期、UI 选型与主界面布局全部锁定，可直接按工单开工。MVP 只支持 macOS arm64，在本地编译出 ad-hoc 签名的 `.app`，不接入 GitHub Actions。

## Notes

- Local Markdown tracker，工单在 `issues/`，答案写在各自 `## Answer`。
- 每次推进先读 [ADR-0001](../../docs/adr/0001-agent-runs-in-bun-sidecar.md)、[ADR-0004](../../docs/adr/0004-test-runner-per-runtime.md)、[ADR-0012](../../docs/adr/0012-single-coding-agent-package.md)、[ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md) 与 [tech-stack](../../docs/tech-stack.md)。
- grilling 工单调用 grilling 与 domain-modeling skill；GUI 外观问题走 prototype。
- 规划为主：产出决策，不在地图内实现。
- GUI 组件与样式严格遵循根目录 [DESIGN.md](../../DESIGN.md)，组件来源遵循 [AGENTS.md](../../AGENTS.md#ui-components)：组件、原语、动效与 Agent 执行反馈优先用 beUI（默认风格含 glass 表面），beUI 未覆盖的角色用 shadcn/ui，编辑器、终端、diff 与虚拟列表用专用库；颜色用 GitHub Light/Dark，字号用 `text-ui-*`，文案走 `@rukie/i18n`；Pencil 视觉稿只提供布局。

## Decisions so far

- [01: 包结构与 Effect 边界](issues/01-packages-and-effect-boundary.md#answer): 新建 `ui`/`server`/`desktop` 三包，`coding-agent/src/view/` 不抽取；Hono 做接入层，Effect 只在 server 内做业务运行层。
- [02: 连接与进程语义](issues/02-connection-and-process-semantics.md#answer): 单 sidecar 多 Session，token + Origin/Host 校验，断连不结算 Interaction，随机端口握手与崩溃重启一次。
- [03: MVP 范围与产品约束](issues/03-mvp-scope.md#answer): 目的地是 spec；浏览器仅作开发模式；最小闭环功能；只支持 macOS arm64，本地编译 ad-hoc 签名 `.app`，不接入 GitHub Actions（2026-10-10 调整）；沿用 Electron 选型；beUI 默认风格（shadcn 补位，见 07 的 2026-10-10 调整）+ Pencil 视觉稿布局；从一开始接 zh/en。
- [08: 确定 Pencil 视觉稿来源](issues/08-task-pencil-design-source.md#answer): `~/Desktop/rukie.pen`，MVP 参照外壳、会话侧栏、新会话、输入框与权限模式、Turn 指示器画板；工具调用块与权限审批卡片无画板，由粗稿补齐。
- [07: shadcn/beui 组件库](issues/07-research-beui.md#answer): beUI（`@beui` registry，MIT）经 shadcn CLI 安装，替代 ai-elements；2026-10-10 改为 beUI 优先、shadcn 补位；覆盖 MVP 主要组件，缺 Markdown 渲染与 i18n，Vite 8 构建未实测。
- [04: Effect 版本与 Bun、Hono 集成](issues/04-research-effect-on-bun.md#answer): 锁定 `effect` 4.0.2，暂不用 platform-bun；进程级 ManagedRuntime + Layer，Run 存于 server 级 FiberMap，中断经 AbortSignal 传给 Agent Core；TypeBox 校验后以 Static 类型进入 Effect。
- [06: 本机 server 的 WS 鉴权方式](issues/06-research-local-server-auth.md#answer): token 走 WS subprotocol，升级前中间件精确校验 Host/Origin/token；生产 Origin 为 `app://rukie`，token 经 preload `getConnection()` IPC 获取；开发模式直连 sidecar，token 走 URL fragment。
- [11: Bun sidecar 的打包与分发](issues/11-research-sidecar-packaging.md#answer): 每平台 `bun build --compile` 经 extraResources 放在 asar 外；`rg` 作为旁置文件传绝对路径；macOS 必须 `allow-jit`；fuses 2.0.0 需在 afterPack 调用；sidecar 关闭 dotenv/bunfig 自动加载并剔除危险环境变量。
- [05: Session store 写者 lease 的并发打开](issues/05-research-store-lease-concurrency.md#answer): lease 按 Session 粒度、同 id 后到者立即失败、崩溃由内核释放；server 需单飞打开并共享 Session，Agent Core 需类型化 busy 错误与容错 `list()`，孤儿 Background Job 待定。
- [12: Agent Core 在 server 中的直接调用](issues/12-research-agent-core-in-server.md#answer): `@rukie/agent` 可直接 import，按 Session 传 cwd/homeDir 支持多项目；server 负责 Interaction 桥接回调、单飞打开与 `onWarning`；Agent Core 需先类型化 busy 错误并让 `list()` 容错。
- [09: 主界面粗稿](issues/09-prototype-main-window.md#answer): 第九轮粗稿已确认：Codex 式外壳、四分组侧栏、折叠 Turn 对话流、输入框上方停靠审批、上下文环与模型详情；组件来源同时改为 beUI 优先、shadcn 补位。
- [10: wire 协议消息清单](issues/10-wire-protocol-messages.md#answer): 单窗口单 WS 按 `sessionId` 复用、新连接接管旧连接，命令全走 WS 并带错误码；SessionEvent 原样转发、Headless 不改，命令用 TypeBox；`InteractionIdentity.epoch` 作关联 ID 并在订阅时补发；运行中发送走原生 `followUp` 成为 Queued Input，可立即发送或撤回，停止时回填输入框；项目与置顶由桌面端注册表维护。
- [18: 孤儿 Background Job 的回收](issues/18-orphan-background-jobs.md#answer): MVP 不回收，记为已知限制，Agent Core 不持久化 pgid；desktop main 停 sidecar 先 SIGTERM、宽限期后 SIGKILL，sidecar 收到 SIGTERM 关闭全部 Session；崩溃后不提示遗留 Job。
- [13: Vitest 在 ui 与 desktop 的接入](issues/13-research-vitest-setup.md#answer): ui 用 Vitest browser mode（Playwright Chromium headless shell + `vitest-browser-react`），desktop main 用 Node 环境 + `vi.mock("electron")`；根 `bunfig.toml` 排除两包使 `bun test` 与 CI 分片不收集；`test:desktop` 只进本地 `check`；test-policy 加 runner 边界；vitest 5.0.3。
- [16: Electron `app://rukie` 文件服务](issues/16-research-electron-app-scheme.md#answer): `ready` 前注册 standard + secure + supportFetchAPI，`loadURL` 前在窗口 session 上 `protocol.handle`，只认 host `rukie`、解码后防越界、SPA 回退、显式 content-type 与 CSP；WS 与 fetch 的 Origin 实测为 `app://rukie`；fuses 全开可用。
- [17: 本地 macOS 打包与签名](issues/17-research-packaging-details.md#answer): `mac.identity: "-"` ad-hoc + hardened runtime，`afterSign` 给 sidecar 只留 `allow-jit`、`rg` 无 entitlement 并重封；构建脚本经 `BUN_BE_BUN=1` 断言 JIT；`rg` 用锁定的 `@vscode/ripgrep` 放 sidecar 旁；本地构建无 quarantine，spctl 不进验收。
- [14: 专用库](issues/14-research-specialized-libraries.md#answer): Transcript 按 Turn 用 `@tanstack/react-virtual` 3.14.14 虚拟化并底部跟随；命令输出 `anser` 2.3.5 + React；diff 用 `diff` 8.0.4 与改造后的 beUI `file-diff`；shiki 4.5.0 `shiki/core` + `@shikijs/stream`；MVP 无编辑器与交互终端。
- [15: beUI 安装实测](issues/15-research-beui-install.md#answer): shadcn CLI 4.21.4 安装 23 个 beUI 组件可构建（需修一处自引用）；点击菜单用 shadcn `dropdown-menu` 补位；主题以 beUI `theme.css` 换 DESIGN.md 值，`text-ui-*` 在 `@theme inline` 定义且 `cn` 必须 `extendTailwindMerge`；拷入后约 100 处字号、90 条文案需改写，正则 lint 可禁非 `text-ui-*` 字号。

- [19: `packages/ui` 分层](issues/19-ui-package-layering.md#answer): `app`/`components`/`store`/`client`/`host` 五层单向依赖，oxlint `no-restricted-imports` 强制；ui 只 `import type` Agent Core 类型；SessionEvent 归约、diff 行与 Markdown 在 ui 重写，不复用 `coding-agent/src/view/`；字典在 `packages/ui/src/i18n/`；host 只有连接、选文件夹、在 Finder 显示、在终端打开四项。
- [20: ADR 清单](issues/20-adr-list.md#answer): 新增四个 ADR（桌面端包结构、server 技术栈、wire 协议与本机鉴权、桌面端存储），部分替代 ADR-0012、整份替代 ADR-0003；ADR-0001、ADR-0004 只更新事实；平台范围、孤儿 Job、签名、专用库不写 ADR。正文在 `/to-spec` 阶段与 spec 一起起草。

- [21: 实现交付](issues/21-agent-core-busy-error-and-tolerant-list.md#answer)：类型化 Session busy 错误、zh/en 呈现与按单个索引容错的列举已完成；真实 lease、warnings、只读列举及恢复消费者均已验证。
- [22: 实现交付](issues/22-agent-core-queued-input.md#answer)：Queued Input 原文、图片与 requestId 公开；followUp、立即发送、撤回及 abort 有序回填使用原生 inbox 和完成记录，恢复与同 Run steering 回归通过。
- [23: 实现交付](issues/23-desktop-workspace-scaffold.md#answer)：ui/server/desktop workspace、五层导入和字号检查、Bun/Vitest 收集边界已接入；桌面测试仅进入本地 check，不进入 CI 分片。
- [24: 实现交付](issues/24-server-wire-core.md#answer)：随机 loopback 端口、Host/Origin/token 校验、单连接接管、Session 单飞与 snapshot 订阅已接入，真实 WS 鉴权和断连继续测试通过。
- [25: 实现交付](issues/25-server-interactions-queue-lifecycle.md#answer)：权限 identity/epoch 桥接、取消与规则覆盖、队列、模型/模式/注册表及空闲关闭已完成。后台权限摘要广播、Core 完成回执和 TUI 中断等待修复已集成，SIGTERM 实际进程退出与持久化均已验证。
- [26: 实现交付](issues/26-desktop-main-and-sidecar.md#answer)：四方法 preload、app scheme/CSP/路径校验、sidecar 握手/环境剔除/重启与退出生命周期已完成。窗口关闭通过 SIGTERM shutdown 先 abort 活跃 Run，再关闭 Session；公开 signal 回归及真实打包退出证据闭合此项。
- [27: 实现交付](issues/27-ui-theme-and-components.md#answer)：beUI 优先、shadcn 补位的组件安装与 GitHub Light/Dark、text-ui 字号、zh/en、减少动态效果已完成。剩余可访问名称本地化和真实 CSP、窄窗口验收已修正并验证。
- [28: 实现交付](issues/28-ui-shell-sidebar-and-new-session.md#answer)：项目与 Session 侧栏、首发创建、输入/模型/权限模式、偏好及连接恢复已完成；侧栏摘要为权威状态，后台运行/审批/结算与重载回归通过。
- [29: 实现交付](issues/29-ui-transcript-tools-and-permissions.md#answer)：原生 Transcript、PromptGroup 虚拟化、Markdown/高亮/ANSI/diff、权限 Dock、队列和草稿所有权已完成；当前长刻度及 portal 预览修复通过实际 Electron hover/focus/键盘/窄窗口验收。
- [30: 实现交付](issues/30-local-macos-build.md#answer)：一条本地 macOS arm64 构建命令生成真实 ad-hoc app；sidecar/rg 外置、精确签名、fuses、strict deep codesign 与 JIT 自检通过。真实编译产物完成流式/审批/bash/rg/Transcript 和进程退出验收。

## Not yet specified

<!-- 目的地已到达：[spec.md](spec.md) 与实现工单 21–30 已切出（2026-10-10）。原 fog 全部归入 spec：DESIGN.md 与 tech-stack 修订、beUI 组件改造进 27 与 29，本地测试与交付规则进 23，打包遗留进 30，待实测项进 27–29 的 GUI 浏览器验证，虚拟列表无障碍记为 spec 已知限制，会话内搜索移出 MVP。 -->

## Out of scope

- Web 产品（远程访问、部署、多用户认证）：以后另开 effort 复用 `packages/ui`。
- Agent Core 迁移到 Effect：与 ADR-0024 大面积交叉，另开 effort。
- Windows、Linux、macOS x64 与 universal 构建，Developer ID 签名、公证与 Windows 签名：MVP 只在本地构建 macOS arm64 的 ad-hoc 签名 `.app`（[03](issues/03-mvp-scope.md#comments) 2026-10-10）。
- 桌面端接入 GitHub Actions（构建、测试分片、打包与发布）：MVP 只在本地编译与验证（[03](issues/03-mvp-scope.md#comments) 2026-10-10）。
- MVP 之外的 TUI 对等能力（Plan Mode、Rewind、Background Jobs 视图、MCP 面板、Goal、slash commands 等）与桌面设置界面。
