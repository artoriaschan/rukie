# @rukie/desktop

Electron host 启动 Bun sidecar，通过受来源校验的 preload 向 renderer 注入四个本机方法。Agent Core 与用户配置由 sidecar 持有，Electron 不导入 Agent Core。

## 入口

[main.ts](src/main.ts) 是 Electron 入口；构建时把 [preload.ts](src/preload.ts) 打成入口旁的 `preload.cjs`，因为 sandbox preload 使用 CommonJS。开发态用 Bun 执行 `packages/server/src/main.ts`，renderer 从 `packages/ui/dist` 加载；打包态从 `app.getAppPath()/dist` 读 renderer，从 `process.resourcesPath/sidecar/rukie-server` 启动 sidecar。两种模式都加载 `app://rukie/`。

`RUKIE_DESKTOP_BUN` 可指定开发态 Bun 可执行文件；`RUKIE_DESKTOP_USER_DATA` 可指定 Electron user-data 目录。测试和 smoke 应同时设置独立 `HOME` 和 user-data 目录：sidecar 从继承的 HOME 定位用户配置，user-data 只隔离 Electron 状态。

## 行为与限制

[DesktopHost](../ui/src/host/index.ts) 只有 `getConnection`、`pickProjectFolder`、`revealPath`、`openInTerminal`。preload 暴露为 `window.rukieHost`；main 只接受本窗口的主 frame 且 URL 为 `app://rukie` 的 IPC。路径必须绝对且不含 NUL；打开 Terminal 使用参数数组，不拼 shell 或 AppleScript。

[Sidecar](src/main/sidecar.ts) 校验 stdout 的 port/token 握手，10 秒未就绪时停止进程。意外退出自动恢复一次；第二次后由 Retry 再调用 `getConnection`。重连必须重新获取 port/token。preload 转发 `rukie:connection-change` DOM 事件，detail 为 `connected`、`disconnected` 或 `reconnecting`，没有新增 host 方法。

关闭窗口或退出应用先发 SIGTERM，通过 server 的内部 shutdown 流程 abort 活跃 Run 并关闭 Session；5 秒未退出才 SIGKILL，等待实际进程退出后再关闭窗口。强杀或崩溃后的孤儿 Background Job 不回收，限制见[桌面端 spec](../../.scratch/desktop/spec.md)。

[app handler](src/main/protocol.ts) 在 loadURL 前注册于窗口 session，路径解码后做目录与 realpath 包含性检查，拒绝 symlink 越界。无扩展名的 route 回退到 index.html，显式设置 MIME，HTML 附 CSP；style-src 允许 self 与 inline 样式，以支持 registry 浮层的滚动锁定与动态样式；script-src 仍只允许 self。生产 UI 浏览器证据见 [issue 27](../../.scratch/desktop/issues/27-ui-theme-and-components.md)，真实打包应用的本地验收见 [issue 30](../../.scratch/desktop/issues/30-local-macos-build.md)。

## 验证

从仓库根运行 `bunx --no -- playwright install --only-shell chromium` 后运行 `bun run test:desktop`。main/preload 的 Node Vitest 测试 mock Electron；sidecar 生命周期驱动真实的假进程，父进程超时用虚拟时钟，cleanup 等实际 exit。打包 Electron smoke 不由这些测试代替。

## 本地构建

前置条件是 macOS arm64、Bun 1.4.2、支持 Vite 的 Node、Xcode Command Line Tools（codesign / plutil），以及 `bun install --frozen-lockfile`。从根目录运行 `bun run desktop:build --out /absolute/task-owned/output`，输出 `package/mac-arm64/Rukie.app` 和 `desktop-build.json`；输出目录的 staging 属于构建脚本，会在下一次构建时清理。默认输出为 `dist/desktop`。

脚本构建 main、CommonJS sandbox preload、当前 UI 入口和编译 sidecar；与 CLI release 共用禁止 dotenv、bunfig、package.json、tsconfig 自动加载的 Bun 编译配置。asar 内只含 JS 与 renderer；`Contents/Resources/sidecar/` 外置 rukie-server 和锁定的 rg，不依赖系统 Bun 或 Homebrew。

`mac.identity: "-"` 执行 ad-hoc hardened-runtime 签名。Electron 与 Helper 保留 disable-library-validation；afterSign 将 sidecar 收紧到仅 allow-jit、rg 清除 entitlement，然后重封外层 app。electron-builder 26.15.3 在 afterPack 之前写入 ElectronAsarIntegrity，脚本检查实际 plist 后启用完整性和 OnlyLoadAppFromAsar fuse，并关闭 RunAsNode、NODE_OPTIONS 和 Node inspect。Cookie Encryption 关闭：桌面端没有 Cookie 使用方，鉴权用 WS token，关闭未使用的加密初始化可避免 ad-hoc 构建启动时请求钥匙串密码；约束与代价见 [ADR-0034](../../docs/adr/0034-desktop-cookie-free-startup.md)。

构建验收针对最终 app：Cookie Encryption fuse 读回必须为关闭、strict deep codesign、runtime flags、sidecar/rg entitlement、实际 rg 版本和 `BUN_BE_BUN=1` DFG JIT 探针。JIT 不可用时构建失败，不按耗时猜测。此命令不调用 spctl，也不证明 Developer ID 签名、公证或分发成功。

打包 smoke 同时隔离 HOME 与 Electron user-data，并仅使用已有 fakeModel 经外部 loopback 传输桥接，不改生产 sidecar。当前打包 smoke 使用普通启动参数，禁止以 `--use-mock-keychain` 代替启动验收。此前开启 Cookie Encryption 的产物曾依赖该测试参数；历史验收详细证据见 [issue 30](../../.scratch/desktop/issues/30-local-macos-build.md)。
