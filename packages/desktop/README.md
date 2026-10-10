# @rukie/desktop

Electron host 启动 Bun sidecar，通过受来源校验的 preload 向 renderer 注入四个本机方法。Agent Core 与用户配置由 sidecar 持有，Electron 不导入 Agent Core。

## 入口

[main.ts](src/main.ts) 是 Electron 入口；构建时把 [preload.ts](src/preload.ts) 打成入口旁的 `preload.cjs`，因为 sandbox preload 使用 CommonJS。开发态用 Bun 执行 `packages/server/src/main.ts`，renderer 从 `packages/ui/dist` 加载；打包态从 `app.getAppPath()/dist` 读 renderer，从 `process.resourcesPath/sidecar/rukie-server` 启动 sidecar。两种模式都加载 `app://rukie/`。

`RUKIE_DESKTOP_BUN` 可指定开发态 Bun 可执行文件；`RUKIE_DESKTOP_USER_DATA` 可指定 Electron user-data 目录。测试和 smoke 应同时设置独立 `HOME` 和 user-data 目录：sidecar 从继承的 HOME 定位用户配置，user-data 只隔离 Electron 状态。

## 行为与限制

[DesktopHost](../ui/src/host/index.ts) 只有 `getConnection`、`pickProjectFolder`、`revealPath`、`openInTerminal`。preload 暴露为 `window.rukieHost`；main 只接受本窗口的主 frame 且 URL 为 `app://rukie` 的 IPC。路径必须绝对且不含 NUL；打开 Terminal 使用参数数组，不拼 shell 或 AppleScript。

[Sidecar](src/main/sidecar.ts) 校验 stdout 的 port/token 握手，10 秒未就绪时停止进程。意外退出自动恢复一次；第二次后由 Retry 再调用 `getConnection`。重连必须重新获取 port/token。preload 转发 `rukie:connection-change` DOM 事件，detail 为 `connected`、`disconnected` 或 `reconnecting`，没有新增 host 方法。

关闭窗口或退出应用先发 SIGTERM，通过 server 的内部 shutdown 流程 abort 活跃 Run 并关闭 Session；5 秒未退出才 SIGKILL，等待实际进程退出后再关闭窗口。强杀或崩溃后的孤儿 Background Job 不回收，限制见[桌面端 spec](../../.scratch/desktop/spec.md)。

[app handler](src/main/protocol.ts) 在 loadURL 前注册于窗口 session，路径解码后做目录与 realpath 包含性检查，拒绝 symlink 越界。无扩展名的 route 回退到 index.html，显式设置 MIME，HTML 附 CSP；style-src 允许 self 与 inline 样式，以支持 registry 浮层的滚动锁定与动态样式；script-src 仍只允许 self。生产 UI 浏览器证据见 [issue 27](../../.scratch/desktop/issues/27-ui-theme-and-components.md)，打包后的 app: 验收仍由打包工单负责。

## 验证

从仓库根运行 `bunx --no -- playwright install --only-shell chromium` 后运行 `bun run test:desktop`。main/preload 的 Node Vitest 测试 mock Electron；sidecar 生命周期驱动真实的假进程，父进程超时用虚拟时钟，cleanup 等实际 exit。打包 Electron smoke 不由这些测试代替。
