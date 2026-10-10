# @rukie/ui

浏览器兼容的 React DOM Frontend，负责主窗口、侧栏、输入框与 wire 状态。组件来源和视觉规则见 [DESIGN.md](../../DESIGN.md)，运行边界见 [ADR-0029](../../docs/adr/0029-desktop-package-structure.md)。

## 使用

`App` 接收 `host` 与 `locale`（`zh` / `en`）。Electron preload 注入 `window.rukieHost` 的 `getConnection`、`pickProjectFolder`、`revealPath` 和 `openInTerminal`；浏览器开发入口从 URL fragment 读取 `port` 与 `token`，立即从 history 清除 fragment，只提供 `getConnection`。完整刷新后需重新附加握手 fragment；当前页面中的 Retry 重用内存中的凭据。浏览器通过手动填写绝对路径添加项目，隐藏 Finder 与终端入口。

从仓库根运行 `bunx --no vite --config packages/ui/vite.config.ts packages/ui`，Vite 固定使用 `http://localhost:5173/`，占用端口时退出；打开此地址并附加 `#port=<sidecar-port>&token=<sidecar-token>`。sidecar 必须以开发模式运行，见 [server README](../server/README.md)。端口和 token 来自当前 sidecar 的 stdout 握手，不放进 query、文件或设置。入口跟随系统主题并按浏览器语言选择 zh/en。

`App` 的可选 `Conversation` 组件接收 Session snapshot、snapshot 之后的 SessionEvent、pending Interaction、连接事实与请求接口，以及受控 draft / images。窗口层拥有标题栏、侧栏、项目选择与输入框；Conversation 层接收摘要开关并拥有对话与停靠内容。`SessionViewState` 归约 Run 开始与结束，保留每个 Session 的最新 snapshot，收到替代 snapshot 时清除旧 delta；Interaction 以 epoch 归约。组件只读 props，app 接线 client、store 和 host。

## 连接与交互

wire client 用每条命令的 `id` 关联 response。每次重连重新调用 `host.getConnection`，重新订阅已打开的 Session；一次网络断开触发重连，失败或 `superseded` 接管后保持断开，等待用户「重试」。Electron 的 `rukie:connection-change` 事件可暂停连接、显示重连或连接重启后的 sidecar。断连立即拒绝未完成命令并禁用发送；未确认 Interaction 在重新订阅时由 server 补发。关闭 App 释放 socket 与监听，不停止 sidecar 的 Run。

首次发送才调用 `session.create`，带目标项目、图片、模型选择与 Permission Mode，不先创建空 Session。已有 Session 的输入走 `prompt`，Run 中交给 server 排队；停止返回的 Queued Input 按顺序放在当前 draft 前，保留图片。Session busy 时保留只读 snapshot 并以重试提示替换输入框。权限、推理档次和上下文面板使用 server 的 `session_state`，模型档次来自目录中的原生能力子集。

⌘N 新建对话，⌘K / Ctrl+K 打开搜索，⌃1–⌃9 按当前「最近」排序选择 Session，⌥⌘P 置顶或取消置顶。分组折叠、显示与排序通过 `preferences.set` 保存。输入框 Enter 发送、Shift+Enter 换行；输入法组合中的 Enter 不发送。纯图标控件带 tooltip 和可访问名称。

## 验证

按 [测试策略](../../docs/testing.md#桌面测试入口) 准备 Chromium 后运行 `bun run test:desktop`。Node client/store 测试和 browser app 测试使用脚本化 wire server，不调用模型，也不接触用户设置或 Session；真实 server 与 Agent Core 行为在 server 包测试。Chromium DOM 验证不能代替本地打包后 Electron 验证。
