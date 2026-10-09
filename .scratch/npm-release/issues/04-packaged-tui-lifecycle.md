# 04：安装后的 TUI 与终端生命周期

Status: resolved
Blocked by: 03

## What to build

Apple Silicon 用户从安装后的 rukie 启动 TUI，看到完整头像资源，并在正常退出或中断后继续使用恢复正常的终端。

## Acceptance criteria

- [x] arm64 安装包通过同一 rukie 入口选择 TUI，保留共用参数解析与 Headless 动态加载边界。
- [x] 头像资源随产物携带并从安装位置或嵌入资源读取；从任意项目目录启动时可用，不以静默降级掩盖缺失资源。
- [x] 从真实安装包以 PTY 启动，使用正常设置连接本地 fake provider，并验证代表性输入及模型响应。
- [x] 正常退出和信号中断恢复终端模式及光标，等待 Session 保存和资源释放；launcher 不造成重复信号或遗留进程。
- [x] 覆盖代表性 resize 与小终端场景，以及可见的恢复 Session 提示；其他既有交互覆盖保持通过。
- [x] arm64 有实机运行证据；源码 app helper 的测试不能替代安装产物 PTY 验收。
- [x] 清理以终端谓词、完成信号或进程退出同步，有诊断性超时，不使用固定等待作为同步。
- [x] 更新安装后的交互使用说明及验收证据，保持 Yoga 实现与既有范围例外。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 14–16、19、33–34。03 提供可运行且身份明确的安装产物；与 05 无相互阻塞。

## Comments

- 2026-10-09：首版只支持 macOS arm64，双架构要求改为 arm64，见父规格 Out of Scope。
- 2026-10-07：拆分已确认。复用既有 terminal/app 测试经验，但安装验收走真实 PTY。

- 2026-10-09：ticket01 agent 领取；确认安装后的真实 PTY 为测试 seam，使用隔离设置与本地 fake provider。

- 2026-10-09：安装包 PTY 验收完成；原始产物 Sixel 测试红（已完成终端能力协商但 10 秒失败界限内没有 DCS raster），两个精确匹配的构建 adapter 修正 worker 嵌入路径与锁定 UPNG 未声明变量，真实安装产物转绿。源码 renderer 与 Yoga 无改动。
- 2026-10-09：Apple Silicon 实机，Bun 1.4.2／Node 26.10.0／npm 11.19.1，本地产物 `/tmp/rukie-release-04`，记录 commit `621ba48c` + dirty true，编译 238ms、构建打包 5538ms。此证据不代表正式发布、外部 CI 或远程认证成功。
- 2026-10-09：安装后的 6 个 PTY case 与既有 TUI main 45 case 共 51 pass、0 fail、257 assertions，11.66s；覆盖完整 Kitty 上传（320×224 RGBA）与 Sixel worker raster、实际键盘输入／本地 provider 回复、可见 Resume 命令及从保存 Session 继续、Ctrl-D／SIGINT／SIGTERM、resize 与小终端。每例核对完整 termios、canonical、echo、alt-screen exit 与 cursor show，且拥有的进程组没有遗留成员。Sixel 单例约 1.49s 是真实 worker 启动／编码与进程关闭成本，无固定等待。
- 2026-10-09：`release:verify --artifact-dir /tmp/rukie-release-04`、tsc、oxlint、Knip、oxfmt、docs:update 与 check:docs 通过；安装包许可／原生资源身份校验继续通过。共享 PTY helper 供后续 MCP OAuth 验收使用，输出只匹配完成信号和终端谓词，失败会报告动作与终端尾部并关闭拥有的进程。
- 2026-10-09：ADR coverage：既有 ADR-0023 承担 npm 分发与资源责任，ADR-0006 承担终端恢复，ADR-0013 承担保持 vendored renderer／Yoga 范围；实现未改变这些决定，无新增 ADR。完整 aggregate check 由父集成任务在所有票完成后执行。
