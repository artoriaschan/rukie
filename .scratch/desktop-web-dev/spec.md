Status: resolved

# Spec: 浏览器开发模式 `dev:desktop:web`

## Problem Statement

调试桌面界面样式时，`bun run dev:desktop` 每次都重新构建 main、preload、UI 与 sidecar，并启动 Electron，没有热更新。浏览器开发模式需要手动启动开发模式 sidecar、从 stdout 读取握手、启动 Vite 并拼接 fragment URL。浏览器中没有 Electron main：已保存的凭证无法解密，新凭证无法加密，模型服务页面与选择文件夹、在 Finder 中显示、在终端打开均不可用，无法用真实模型调试。后续本机 Web 产品同样需要这些能力。

## Solution

新增根脚本 `bun run dev:desktop:web`：一条命令启动源码 sidecar 与 Vite dev server，打印带一次性握手 fragment 的地址，改动 UI 时由 HMR 即时更新。sidecar 在浏览器形态下自己负责凭证加密（系统钥匙串主密钥），模型服务和原生能力经现有会话 WS 命令提供，浏览器中的界面与桌面应用功能一致，使用真实模型。`--isolated` 为代理验收提供临时配置、内存加密与本机 fake 供应商，不接触用户凭证。架构决定见 [ADR-0037](../../docs/adr/0037-browser-host-sidecar-capabilities.md)。

## User Stories

1. 作为开发者，我运行一条命令就能在浏览器中打开桌面界面，修改样式后立即看到结果，不重建 Electron。
2. 作为开发者，我在浏览器中录入真实供应商与 API Key，用真实模型对话来调试消息、思考、工具卡与流式效果；切换 checkout 后不必重新录入。
3. 作为开发者，我在浏览器中选择项目文件夹、在 Finder 中显示文件、在终端打开项目，与桌面应用一致。
4. 作为开发者，我可以同时运行 `dev:desktop` 与 `dev:desktop:web`，两者的 Session 与配置互不干扰。
5. 作为代理，我用 `--isolated` 启动一次性环境完成 agent-browser 验收，不读取、不写入用户真实凭证与 Session，不触发系统钥匙串。
6. 作为开发者，Ctrl+C 退出后 sidecar 与 Vite 都已结束，端口与锁释放；任一进程意外退出时命令报错退出。

## Implementation Decisions

### 启动器

- 根脚本 `dev:desktop:web` 运行 `scripts/desktop/web.ts`。源码运行 `packages/server/src/main.ts --dev`，不编译 sidecar，不改生产入口；sidecar 只接收 Electron 正式启动同样使用的私有启动变量及本次新增的加密后端选择，没有开发专用旁路。
- 启动器拒绝继承 `RUKIE_DESKTOP_*`、`NODE_OPTIONS`、`BUN_OPTIONS` 等会改变 sidecar 行为的环境变量，规则与 `developmentEnvironment` 一致。
- 顺序：取得 `.desktop-dev/web/launcher.lock` → 启动 sidecar，stdout 管道读取一行 `{port, token}` 握手（有界超时），stderr 透传 → 启动 Vite（`packages/ui/vite.config.ts`，固定 `localhost:5173`，占用即退出）→ 打印 `http://localhost:5173/#port=…&token=…`。`--open` 时用系统默认浏览器打开。
- 退出：SIGINT/SIGTERM 先停 Vite 再停 sidecar，等待两者实际退出后释放锁；任一子进程意外退出时停止另一个并以非零码退出；握手超时打印 sidecar stderr 后退出。
- 数据根 `.desktop-dev/web/data`（项目、Session、附件），跨重启保留；`--reset` 只清空该目录，不清理凭证与配置。与 `dev:desktop` 的 `.desktop-dev/data` 分开，两个命令可以同时运行；同一 checkout 只允许一个 web 实例。
- 不限定 macOS；能运行 Bun 与 Vite 即可。sidecar 源码修改需重启命令。

### 配置与加密

- 配置根跨 checkout 共享，位于用户级应用数据目录下的 `Rukie Web Development/configuration`（macOS：`~/Library/Application Support/`；Linux：`$XDG_DATA_HOME` 或 `~/.local/share`；Windows：`%APPDATA%`），保存供应商、模型、凭证密文与设置；与 `dev:desktop` 的共享配置分开，二者密文后端不同。目录与父路径拒绝符号链接，沿用 `developmentPaths` 的检查。
- sidecar 新增显式加密后端选择：`electron`（现有私有通道）、`system-keychain`、`memory`。未选择或参数不完整时启动失败，不推断。
- `system-keychain` 经 `Bun.secrets` 在系统凭据库保存每个安装一把 AES-256-GCM 主密钥，服务名由启动方传入（本入口为 `Rukie Web Development`），密文绑定凭证身份，格式与现有 vault 的身份校验一致。首次加密时创建主密钥，在共享配置根内按 service 派生的 SQLite guard 下重新读取后创建，跨进程互斥，guard 不存密钥且进程退出自动释放锁；读取失败或授权取消返回现有可重试错误，不新建覆盖。
- `memory` 主密钥只在进程内存，仅 `--isolated` 使用。

### wire 命令

在 `@rukie/shared` 的 `WireCommandSchema` 新增，由 server 校验：

- `modelServices.list / save / delete / test / revealKey / templates / prices`：语义与现有 `/private/model-services` 一致，复用同一处理逻辑。`save` 的凭证为 `keep`、`delete` 或 `replace` 明文，sidecar 立即加密。`revealKey` 只返回指定供应商的 API Key。`electron` 后端拒绝这些命令（返回明确错误码），Electron 继续走 IPC。
- `host.pickFolder`：sidecar 弹出系统选择文件夹对话框。macOS 用固定 AppleScript 源的 `osascript`；其他平台返回 `unsupported`，界面退回手动填写路径。
- `host.revealPath` / `host.openInTerminal`：路径必须为已存在的绝对路径，且位于已登记项目根、无项目会话 workspace 或其子路径。macOS `open -R` / `open -a Terminal`，Linux `xdg-open`（显示文件时打开所在目录），Windows `explorer /select,` 与默认终端；参数向量执行，不经 shell。

明文 API Key 与 `revealKey` 返回值不进入 server 日志、snapshot、错误消息或模型上下文。

### ui 与 desktop

- 浏览器入口的 host 经 wire client 实现完整 `DesktopHost`：`pickProjectFolder`、`modelServices` 走上述命令；删除 `browserHost()` 只提供连接的降级路径与相应隐藏分支。
- `revealPath` 与 `openInTerminal` 从 `DesktopHost` 移出，Electron 与浏览器都由 app 经 wire 命令调用；删除 main 的 `rukie:revealPath` / `rukie:openInTerminal` IPC 与 preload 暴露。Electron 保留窗口内的 `pickProjectFolder` 与模型服务 IPC。
- 依赖方向保持 ADR-0029：`host` 只被 `app` 与 `client` 使用，浏览器 host 组合 client，不导入 store 或 React。

### `--isolated` 验收模式

- 配置根与数据根在本次运行的临时目录，退出时删除；加密后端 `memory`；不访问系统钥匙串。
- 启动一个本机 OpenAI 兼容 fake 端点（复用 `scripts/release/tests/provider-protocol.ts` 的协议回包，只监听 loopback），握手后经 `modelServices.save` 预置指向它的供应商与模型。模型服务页面、模型选择器与对话都走真实代码路径，只有网络对端是假的。fake 只返回固定回复，不提供丰富内容场景。
- AGENTS.md 与 testing.md 的“mock DesktopHost / 模拟 DesktopHost”改为 `dev:desktop:web --isolated`；`test:desktop` 自动测试的 mock 边界不变。

## Testing Decisions

- 启动器：`scripts/tests/` 用桩子进程覆盖握手解析、握手超时、锁冲突、SIGINT 顺序退出并释放锁、子进程崩溃连带退出、`--reset` 只清数据、拒绝继承的私有环境变量；不依赖固定 sleep，使用进程退出与输出事件同步。
- 加密后端：注入假的 secrets store 测试主密钥创建、复用、读取失败不覆盖、身份绑定、后端未选择时启动失败；不访问真实钥匙串。
- server wire：新命令的 schema 校验、Origin 与 token 校验沿用；路径限制与不存在路径拒绝；`electron` 后端拒绝模型服务命令；明文与 `revealKey` 返回值不出现在 snapshot、日志与错误中；保存与删除保持供应商与凭证同事务。系统对话框与外部进程通过注入的执行接口验证参数向量，不真实弹窗。
- ui：Chromium 浏览器测试用脚本化 wire server 覆盖浏览器 host 的模型服务流程、选择文件夹（成功、取消、unsupported 退回手填）与显示/终端入口；Electron 形态的入口改由 wire 调用。
- desktop：随 IPC 删除更新 main/preload 测试，验证 reveal/terminal IPC 不再注册。
- 真实系统钥匙串与真实浏览器 + 真实供应商的手动验收遵循 [testing.md 原生验收授权边界](../../docs/testing.md#原生验收授权边界)，不进自动化测试。

## Implementation Tickets

| Ticket                                         | 内容                                                   | Blocked by |
| ---------------------------------------------- | ------------------------------------------------------ | ---------- |
| [01](issues/01-sidecar-encryption-backends.md) | sidecar 加密后端显式选择、`system-keychain` / `memory` | —          |
| [02](issues/02-launcher.md)                    | `dev:desktop:web` 启动器、锁、握手、Vite、退出         | 01         |
| [03](issues/03-model-services-wire.md)         | `modelServices.*` wire 命令与浏览器 host 模型服务      | 01         |
| [04](issues/04-host-wire-commands.md)          | `host.*` wire 命令、浏览器原生能力、Electron 迁移      | —          |
| [05](issues/05-isolated-acceptance.md)         | `--isolated` 验收模式与文档更新                        | 01, 02, 03 |

启动器依赖显式后端选择，因此 01 先于 02。02 完成后即可在浏览器中调试布局与会话样式；录入供应商和真实对话需要 03。

## Out of Scope

- 托管、远程或多用户 Web 产品，以及 Web 产品的打包、部署与登录。
- sidecar 源码修改的自动重启。
- fake 端点的丰富内容场景；丰富内容由开发者用真实模型调试。
- Linux 与 Windows 的系统选择文件夹对话框。
- Electron 改用 sidecar 加密或 WS 模型服务通道。
- 在 `dev:desktop`、`dev:desktop:web` 与正式应用之间导入或迁移配置。

## ADR Coverage

| 决定或修改                                            | 归属                                                                                                                                                                       | 理由                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 浏览器形态凭证加密由 sidecar 系统钥匙串后端负责       | 新增 [ADR-0037](../../docs/adr/0037-browser-host-sidecar-capabilities.md)，部分替代 [ADR-0035](../../docs/adr/0035-desktop-isolated-sqlite-storage.md)                     | 改变凭证加密所有权，显式选择后端、不回退                                    |
| 浏览器形态模型服务与凭证经会话 WS                     | 新增 [ADR-0037](../../docs/adr/0037-browser-host-sidecar-capabilities.md)，部分替代 ADR-0035，沿用 [ADR-0031](../../docs/adr/0031-desktop-wire-protocol-and-local-auth.md) | 改变凭证传输通道；命令仍走唯一 WS，不另开 HTTP                              |
| reveal/terminal 迁到 sidecar，Electron 与浏览器共用   | 新增 [ADR-0037](../../docs/adr/0037-browser-host-sidecar-capabilities.md)                                                                                                  | 改变原生能力的执行所有权与路径授权                                          |
| 浏览器 host 组合 wire client                          | 沿用 [ADR-0029](../../docs/adr/0029-desktop-package-structure.md)                                                                                                          | `host` 只被 `app`、`client` 使用的依赖方向不变                              |
| 浏览器开发配置跨 checkout 共享、与 `dev:desktop` 分开 | 沿用 [ADR-0036](../../docs/adr/0036-shared-development-configuration.md) 的共享原则                                                                                        | 同一取舍应用到新的开发入口；独立配置根由后端密文不兼容决定，记录在 ADR-0037 |
| 启动器编排、锁、`--reset`、`--isolated`               | 无需 ADR                                                                                                                                                                   | 开发工具的进程编排，可直接回退，不改变产品行为或数据所有权                  |

## 验证记录

基线提交：`5b65547d`（`origin/main`）。设计提交：`d75580fc`。本次集成分支 `feat/desktop-web-dev-complete`。实施代理在各自 ticket 记录 focused TDD 与耗时，主代理协调集成静态检查、desktop 包级验收与隔离浏览器验收；集成与交接复用仍有效证据。

## 最终交付与 ADR Coverage 复核

实现集成至 `5fb02150`，最终状态提交只更新本 spec 和 03/05 的关闭证据。五张票的实现、消费者与文档已对齐；01/02/04 的已通过证据复用，03/05 与 spec 在本次统一 resolved。PR #17 将转为 ready for review，CI 待验收，未授权或执行合并。

逐项复核 Implementation Decisions 与最终 diff：加密所有权、显式后端与单主密钥及共享初始化锁沿用 ADR-0037；浏览器模型服务经唯一鉴权 WS，Electron 保留 IPC，沿用 ADR-0037/0031；原生操作由 sidecar 校验 canonical 项目/workspace 路径并以参数向量执行，沿用 ADR-0037；host 组合 App 唯一 client，保持 ADR-0029 依赖方向；共享配置与 checkout Session/data 的隔离沿用 ADR-0036/0037。启动器与一次性 fake/临时目录属于开发编排，不引入新的产品数据或执行边界，无需新增 ADR。覆盖表链接与 accepted 状态已核对，没有遗漏的长期取舍或未解决冲突。

双轴评审：Standards 两项 P2（启动器测试 timeout cleanup、browser host 初始化失败 cleanup），Spec 一项 P1（独立实例首次主密钥创建竞争）。全部由新的单个实施代理修复，提交 `5fb02150`；竞争回归先复现两次创建，修复后单次创建，并覆盖进程强制退出释放锁和失败重试不覆盖已有密钥。每个实施、合并、评审与修复阶段都创建新代理，没有复用代理。

本地证据：集成 `5a4ff88e` 的 `rtk proxy bun run check:dev` 退出 0，`rtk proxy env -u NO_COLOR bun run test:desktop` 29 files / 128 tests 通过，23.32s；评审差异由 crypto/startup/launcher 28 pass（3.17s）和 Chromium host 4 pass（5.86s）补验，workspace types、受影响 lint/format、docs 与 test-policy 通过。生产 UI 与 memory 隔离链路没有改变，包级与浏览器证据继续有效；没有重跑未失效的完整套件。最终 tracker 状态变化仅补文档、scratch、格式和 diff 检查。

实际 agent-browser Chromium 验收：`bun run dev:desktop:web --isolated` 源码 sidecar、预置和 Vite 就绪；浏览器显示模型服务，显式显示/隐藏 key（未输出明文），保存模型名称后选择器同步，键盘选择后真实 Session 返回 `packaged protocol reply`。Light/Dark 和 640px 窄屏已截图核对，无页面横向溢出；model button 与嵌套 SVG 为 pointer，disabled send 为 not-allowed；fragment 清除，控制台无错误，已观察网络请求无失败状态。验收自动化曾因 aria-only 按钮选择条件与过期 refs 超时，刷新条件/快照后同一交互成功，记录为自动化操作失败。浏览器已关闭，Ctrl+C 后 sidecar PID 消失，5173/sidecar/fake 三个端口关闭，临时目录删除；外层 bun run PTY 因中断返回 1，所属资源清理完成。

日志、评审与图片：`/tmp/rukie-desktop-web-evidence/verification.md`、`review-fixes-verification.md`、`check-dev.log`、`test-desktop.log`、`review-standards.md`、`review-spec.md`、`review-focused-green.log`、`review-browserhost-green.log`、`settings-light.png`、`settings-dark.png`、`settings-narrow.png`、`conversation-dark.png`。日志属于本机任务证据，不提交临时 token 或密钥。

限制：未访问真实系统钥匙串、真实供应商凭证或启动真实 Electron/原生对话框/文件管理器/终端；其他操作系统的真实原生运行未验收。自动测试通过注入验证平台参数向量与路径限制。CI 的最新提交结果以 PR checks 为准，本地通过不代表 CI 已通过。

追加的供应商空地址改名修复及增量验证见 [ticket 03](issues/03-model-services-wire.md#追加修复未配置地址时修改供应商名称)。草稿改名与正式配置保存的边界已同步 ui README；其余已通过证据按实际差异继续复用。

追加页面系统字体要求：GUI 统一使用 `system-ui` 平台字体，代码、模型标识、快捷键与数值使用系统 `ui-monospace`；字号、字重、行高与布局保留。DESIGN.md 与 tech-stack 已同步，移除两项字体包、四个导入、六处 scoped 覆盖及不再发行的许可证资源，lockfile 与 frozen install 对齐。这属于用户追加的展示要求，不改变执行或存储边界，无需 ADR。字体源样式的基线 5+7 个浏览器布局案例通过；新增实际 font-family / 无 bundled FontFace 回归先 RED，再随全部 12 个案例通过（7.24s）。check:dev、类型/Knip/文档/测试策略及字体扫描通过；实际浏览器检查系统字体、零字体文件请求、Light/Dark/窄屏和无横向溢出。原有 desktop 包级未受影响证据复用，字体差异由这组 focused 证据覆盖，未重跑整套。验收沿用用户现有 Vite，独立 memory/fake sidecar 已清理；PID 74227 的用户服务保持监听 5173。详情与图片在 `/tmp/rukie-desktop-web-evidence/system-font-verification.md` 及 `system-font-*.png`。

追加断线修复验证记录：现场 Vite 与 sidecar 均在运行；窄屏标题隐藏曾干扰首次断言，改为固定宽度与直接检查恢复握手后，旧实现明确抛出 Missing development connection fragment（RED，2.02s）。当前标签页 sessionStorage 保留握手，新 fragment 替换缓存，无效端口或 WebSocket 子协议非法 token 清除缓存，缺少握手显示明确启动地址提示；源 ADR 与 README 已同步。新建只读评审代理发现非法 token 缓存边界，已加入校验与回归。host browser 和 client 合计 13 案例通过（5.35s），check:dev 通过；复用已有 desktop 包级与布局证据，不重跑无关整套。

实际 agent-browser Chromium 使用独立 memory sidecar/fake provider，复用用户仍运行的源码 Vite：完整 URL 首次连接后 fragment 清除，实际 reload 后模型仍就绪；Light/Dark 与 640px narrow 截图均核对，无横向溢出与操作失败，控制台无错误，所观察网络请求均成功。清除测试标签页握手再 reload，Retry 显示中文启动地址提示，窄屏无溢出。测试浏览器关闭，独立 sidecar 58856 端口关闭；用户 Vite 74227、sidecar 74225、launcher 74224 全程仍在运行。证据：`/tmp/rukie-disconnect-{red,green,static}.log` 与 `/tmp/rukie-desktop-web-evidence/reload-{light,dark,narrow,missing-handshake}.png`。此修复确认重载失去握手的路径；未直接读取用户原浏览器，不能断言其当次触发必为重载。
