# @rukie/desktop

Electron host 启动 Bun sidecar，通过受来源校验的 preload 向 renderer 注入受限本机操作与模型服务管理方法。Agent Core 与用户配置由 sidecar 持有，Electron 不导入 Agent Core。

## 入口

[main.ts](src/main.ts) 是 Electron 入口；构建时把 [preload.ts](src/preload.ts) 打成入口旁的 `preload.cjs`，因为 sandbox preload 使用 CommonJS。开发态用 Bun 执行 `packages/server/src/main.ts`，renderer 从 `packages/ui/dist` 加载；打包态从 `app.getAppPath()/dist` 读 renderer，从 `process.resourcesPath/sidecar/rukie-server` 启动 sidecar。两种模式都加载 `app://rukie/`。

`RUKIE_DESKTOP_BUN` 可指定开发态 Bun 可执行文件；`RUKIE_DESKTOP_USER_DATA` 可指定 Electron user-data 目录。业务数据根由 main 决定：生产默认为 `app.getPath("userData")/data`，开发与测试必须显式设置绝对路径 `RUKIE_DESKTOP_DATA_ROOT`，否则启动失败。main 通过私有 sidecar 启动环境传递数据根与真实 OS home；工具和权限的 `~/` 展开使用真实 home，用户配置不从 OS home 发现，也不导入旧目录。user-data 仍隔离 Electron 状态。

macOS 启动时通过用户的登录交互 shell 读取环境变量，使 Finder 双击启动的工具子进程保留正常系统环境。供应商认证使用独立桌面来源，不读取终端环境 API Key，也不向工具环境注入桌面凭证。优先使用继承的绝对 `SHELL` 路径，否则使用系统账户 shell；读取最多等待 5 秒，失败或超时沿用继承环境，并等待读取进程退出。继承变量优先于 shell 导出值，显式 `HOME` 与 user-data 隔离设置保持有效。环境值仅在内存中交给 sidecar，不写入配置或日志；sidecar 仍移除 Bun、Node 和动态库注入变量。此行为仅属于桌面启动，Headless CLI 与 TUI 的环境来源不变。

## 行为与限制

[DesktopHost](../ui/src/host/index.ts) 提供 `getConnection`、`pickProjectFolder` 和 `modelServices.list/save/delete/revealKey`。模型服务列表仅包含凭证存在状态，保存可保留、替换或删除凭证；`revealKey(id)` 仅供主动显示指定供应商的 API Key，不开放任意解密；普通启动和列表不解密，展示值仅存在当前详情内存，失败保留密文。preload 暴露为 `window.rukieHost`；main 只接受本窗口的主 frame 且 URL 为 `app://rukie` 的 IPC。显示路径与打开终端由 app 经 `host.revealPath` / `host.openInTerminal` wire 命令交给 sidecar；main 与 preload 不再提供这两个 IPC。sidecar 只接受已存在的绝对路径，限制在已登记项目根或无项目 workspace 及其子路径，拒绝符号链接逃逸。外部进程使用参数向量，不拼 shell 或 AppleScript。

[safeStorage 服务](src/main/secrets.ts) 由 main 持有，按供应商、OAuth 或配置身份绑定密文，sidecar 经独立随机 token 的私有 loopback 通道调用；renderer Origin 一律拒绝。加密不可用、系统授权取消、解密失败均返回可重试错误，保留旧密文，禁止明文及 basic_text fallback。服务仅在显式凭证操作或执行用途调用系统加解密，普通启动不初始化 Cookie 加密。真实系统加密验收与 mock 测试分开，见[存储票据 06](../../.scratch/desktop-storage/issues/06-integration-and-packaged-acceptance.md)。

[Sidecar](src/main/sidecar.ts) 校验 stdout 的 port/token 握手，10 秒未就绪时停止进程。意外退出自动恢复一次；第二次后由 Retry 再调用 `getConnection`。重连必须重新获取 port/token。preload 转发 `rukie:connection-change` DOM 事件，detail 为 `connected`、`disconnected` 或 `reconnecting`，没有新增 host 方法。

关闭窗口或退出应用先发 SIGTERM，通过 server 的内部 shutdown 流程 abort 活跃 Run 并关闭 Session；5 秒未退出才 SIGKILL，等待实际进程退出后再关闭窗口。强杀或崩溃后的孤儿 Background Job 不回收，限制见[桌面端 spec](../../.scratch/desktop/spec.md)。

[app handler](src/main/protocol.ts) 在 loadURL 前注册于窗口 session，路径解码后做目录与 realpath 包含性检查，拒绝 symlink 越界。无扩展名的 route 回退到 index.html，显式设置 MIME，HTML 附 CSP；style-src 允许 self 与 inline 样式，以支持 registry 浮层的滚动锁定与动态样式；script-src 仍只允许 self。生产 UI 浏览器证据见 [issue 27](../../.scratch/desktop/issues/27-ui-theme-and-components.md)，真实打包应用的本地验收见 [issue 30](../../.scratch/desktop/issues/30-local-macos-build.md)。

## 验证

从仓库根运行 `bunx --no -- playwright install --only-shell chromium` 后运行 `bun run test:desktop`。main/preload 的 Node Vitest 测试 mock Electron；sidecar 生命周期驱动真实的假进程，父进程超时用虚拟时钟，cleanup 等实际 exit。打包 Electron smoke 不由这些测试代替。

## 桌面开发调试

在 macOS arm64、Bun 1.4.2、Node 与 Xcode Command Line Tools 环境中，安装锁定依赖后，从仓库根运行：

```sh
bun run dev:desktop
```

命令每次构建当前 main、sandbox preload、UI 与 sidecar，在独立的 **Rukie Development** 中打开 DevTools。源码修改后关闭开发应用，再重新运行命令；当前入口不提供自动热更新。main/preload 与 UI 附 source map。renderer 仍由 `app://rukie` 加载，沿用正式版的 CSP、sandbox、preload 来源与 IPC 校验，不开放 HTTP 调试服务或远程调试端口。

开发状态固定在当前 checkout 的 `.desktop-dev/`，已加入 Git ignore：`data/` 保存工作区项目、Session 索引、置顶、Session 与附件；`electron/` 保存 Electron userData 和单实例锁；`session/` 保存 Chromium session/storage；`cache/` 缓存独立开发 app，Chromium 的 cache 由独立 sessionData 归属；`build/` 保存本次构建。目录、构建产物、业务数据完整树与缓存 app 不接受符号链接。Electron userData/session 的其他持久化树同样拒绝链接；仅 Chromium 的 SingletonLock/Cookie/Socket 链接不跟随目标，确认其原进程已退出并取得开发入口锁后只移除这些原生 IPC 链接，允许正常重启。开发入口在构建前取得独占 launcher 锁，已有开发命令运行时拒绝第二次构建；异常崩溃遗留锁时，只在确认其所有进程退出后手动移除 `.desktop-dev/launcher.lock`。重启保留开发数据。不同 checkout 的开发版共用 `~/Library/Application Support/Rukie Development/configuration/app.sqlite` 中的供应商、凭证密文、用户设置、偏好与模型能力缓存；项目、置顶和 Session 继续按 checkout 隔离。入口拒绝公共配置目录及其业务树的符号链接。启动器不自动扫描或迁移旧 checkout；旧配置只在用户明确要求时导入。开发版不读取或覆盖正式应用或终端的配置、凭证与 Session，工具仍使用真实 OS home。共享边界见 [ADR-0036](../../docs/adr/0036-shared-development-configuration.md)。

开发 app 使用 `rukie-desktop-development` 名称和 `dev.rukie.desktop.development` bundle identity。首次运行缓存锁定 Electron；若依赖尚无原生 runtime，调用锁定包的安装入口下载。开发 bundle 关闭 Cookie Encryption 并 ad-hoc 签名；后续启动校验身份、fuse 与签名，manifest 使用 bundle 内相对的 ESM bootstrap 入口，以正确的 file URL 等待当前 checkout 的 main 执行完成，保证 ready 前身份和路径配置的时序。源码产物在 bundle 外重建，不因每次源码修改重新签名；旧入口格式使缓存自动重建，只替换开发 runtime 缓存，保留业务和 Electron 数据。macOS safeStorage 的 service/account 来源及原生验收边界见 [ADR-0035](../../docs/adr/0035-desktop-isolated-sqlite-storage.md)。显式保存凭证可能请求开发身份的系统钥匙串授权；独立数据目录本身不能证明系统凭证行为已验收。

入口拒绝继承 `RUKIE_DESKTOP_*`、`NODE_OPTIONS`、`BUN_OPTIONS`、`BUN_BE_BUN`、`DYLD_*` 与 `ELECTRON_*` 启动覆盖项，提示先移除变量，不接受正式数据路径的参数。sidecar 每次从当前源码编译，禁用 dotenv、bunfig、package.json 与 tsconfig 自动加载，避免开发运行采用用户 Bun 配置或隐式凭据。`Ctrl+C`、`SIGTERM` 或关闭开发窗口时等待所属进程退出；优雅退出失败才按有界退出探测终止所属进程组，并确认组中已无可继续工作的成员；不能确认清理完成时以非零状态失败并保留 launcher 锁，保留开发数据。构建或启动失败以非零状态退出，不影响已打开的正式应用或其他预览窗口。

## 本地构建

前置条件是 macOS arm64、Bun 1.4.2、支持 Vite 的 Node、Xcode Command Line Tools（codesign / plutil），以及 `bun install --frozen-lockfile`。从根目录运行 `bun run desktop:build --out /absolute/task-owned/output`，输出 `package/mac-arm64/Rukie.app` 和 `desktop-build.json`；输出目录的 staging 属于构建脚本，会在下一次构建时清理。默认输出为 `dist/desktop`。

脚本构建 main、CommonJS sandbox preload、当前 UI 入口和编译 sidecar；与 CLI release 共用禁止 dotenv、bunfig、package.json、tsconfig 自动加载的 Bun 编译配置。asar 内只含 JS 与 renderer；`Contents/Resources/sidecar/` 外置 rukie-server 和锁定的 rg，不依赖系统 Bun 或 Homebrew。

macOS 应用图标直接使用 [brand/rukie-app-icon.icns](../../brand/rukie-app-icon.icns)，素材说明与重新导出命令见[品牌设计](../../brand/design.md#桌面应用图标)。

`mac.identity: "-"` 执行 ad-hoc hardened-runtime 签名。Electron 与 Helper 保留 disable-library-validation；afterSign 将 sidecar 收紧到仅 allow-jit、rg 清除 entitlement，然后重封外层 app。electron-builder 26.15.3 在 afterPack 之前写入 ElectronAsarIntegrity，脚本检查实际 plist 后启用完整性和 OnlyLoadAppFromAsar fuse，并关闭 RunAsNode、NODE_OPTIONS 和 Node inspect。Cookie Encryption 关闭：桌面端没有 Cookie 使用方，鉴权用 WS token，关闭未使用的加密初始化可避免 ad-hoc 构建启动时请求钥匙串密码；约束与代价见 [ADR-0034](../../docs/adr/0034-desktop-cookie-free-startup.md)。

构建验收针对最终 app：Cookie Encryption fuse 读回必须为关闭、strict deep codesign、runtime flags、sidecar/rg entitlement、实际 rg 版本和 `BUN_BE_BUN=1` DFG JIT 探针。JIT 不可用时构建失败，不按耗时猜测。此命令不调用 spctl，也不证明 Developer ID 签名、公证或分发成功。

打包 smoke 显式隔离应用数据根与 Electron user-data，保留真实工具 home，并仅使用已有 fakeModel 经外部 loopback 传输桥接，不改生产 sidecar。当前打包 smoke 使用普通启动参数，禁止以 `--use-mock-keychain` 代替启动验收。此前开启 Cookie Encryption 的产物曾依赖该测试参数；历史验收详细证据见 [issue 30](../../.scratch/desktop/issues/30-local-macos-build.md)。

Electron 在初始化窗口和 sidecar 前取得单实例锁；第二实例退出并让现有窗口恢复、聚焦。宿主关闭拒绝新 IPC，幂等 shutdown 等待 sidecar 实际退出后关闭私有加密服务；sidecar 排空输出、Session 与 SQLite，释放执行 lease。系统凭证只通过明确录入/替换/删除操作接触 safeStorage；取消、系统加密不可用或解密失败不能报告保存成功。

模型高级设置的压缩阈值填写上下文占用百分比（1–100），工具迭代填写每次 Run 的整批工具轮数上限；达到上限后模型可在无工具请求中总结。留空保留默认行为。Temperature 与 USD/百万 Token 价格按选定模型生效，价格来源仅为元数据。当前锁定 Harness 的子代理压缩沿用根 Session 策略，子代理不同模型的阈值不单独生效。
