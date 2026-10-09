# 02：Apple Silicon 安装包运行 Headless Session

Status: resolved
Blocked by: 01

## What to build

Apple Silicon 用户从真实 npm tarball 安装主包与 arm64 平台包后，使用 rukie 完成实际 Headless Session，无需源码仓库、外部 Bun 或另装 ripgrep。这条路径建立后续平台和发布工作的可运行基线。

## Acceptance criteria

- [x] 使用固定 Bun 版本生成主包及 arm64 平台 tarball，产品版本、平台依赖和命令输出一致。
- [x] 主包 launcher 通过精确版本 optionalDependencies 定位支持的平台，平台包声明 os/cpu；缺失 optionalDependencies 或不支持的平台给出明确修复提示。
- [x] launcher 保持 cwd、环境、标准 IO、信号和退出状态；带空格的安装路径及仓库外项目目录正常工作。
- [x] 构建适配 pi 输出捕获动态引用，不另写 pi 业务实现；工具资源不依赖源码或构建宿主绝对路径。
- [x] arm64 `rg` 从 `@vscode/ripgrep-darwin-arm64` 复制为平台包内与 `rukie` 同目录的独立可执行文件；Agent Core grep 在编译产物中按 `realpath(process.execPath)` 所在目录定位（构建期常量区分编译产物），源码运行保留 `@vscode/ripgrep` 解析。经 npm bin 符号链接和用户软链接启动均能找到；`rg` 缺失或不可执行时返回 `ripgrep-unavailable`，提示平台包不完整。
- [x] 编译关闭 `.env` 与 `bunfig.toml` 自动加载；项目目录含 `.env`、`bunfig.toml`（含 preload）时安装后的命令不加载它们。
- [x] tarball 使用文件白名单，无 workspace 依赖声明、源码 bin/SDK exports、测试、凭据、用户设置或 Sessions；MIT 许可与第三方声明可从安装包读取。
- [x] 在临时 HOME 和项目目录安装实际 tarball，经正常设置连接本地 fake provider，运行 Session 并验证 stdin、text/stream-json、参数错误、help/version 与退出码。
- [x] 从安装后的命令验证 grep、bash 输出捕获及进程清理、中断和 Session Resume；产品子进程 PATH 不提供 Bun 或额外 ripgrep。
- [x] Headless 执行不初始化 React/renderer；内部 workspace 开发方式和权限/project trust 语义保持一致。
- [x] 提供可重复的本地构建、安装及验收操作，记录实际 arm64 验收和必要的编译/进程启动成本。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 1、3–13、17–19、22–23、27–32、34、47。01 提供构建与产物必须消费的产品版本契约。完整 provider/auth 覆盖由 05 交付，Yoga 沿用确认的范围例外。

## Comments

- 2026-10-09：依据桌面端 sidecar 打包调研的实测结论补充 ripgrep 旁置定位与 Bun 自动加载两条验收，见父规格实现决定 6、7。
- 2026-10-07：拆分已确认。验收以实际安装包为入口，不将源码测试成功当作发包成功。

- 2026-10-09：完成 Apple Silicon 本地构建／安装基线。新增 release:build、release:accept、.bun-version、Node execve launcher 与真实安装 fixture；产品 manifest 版本统一到两个 tarball、精确 optionalDependencies 与命令输出。平台包仅支持 darwin/arm64，launcher 检查 Node >=24.15.0、平台包版本和执行权限，保留 cwd、环境、IO、进程身份及 SIGINT／SIGTERM 退出状态。
- 构建编译原始 main 与原始 sixel worker，嵌入头像；复制锁定 arm64 rg、sharp addon 与上游相对布局的 libvips。静态注册 pi 原有 OAuth／Bedrock 模块，不添加新 Session 路径或旧 pi capture shim；当前 bash capture 由 Rukie 自有模块实现。编译关闭 dotenv/bunfig/tsconfig/package.json 自动加载，环境变量不被构建内联。
- TDD 已在安装命令入口复现旧 rg 动态 locator 找不到 @vscode/ripgrep-darwin-arm64；改为构建期常量选择 realpath(process.execPath) 同目录 rg 后，实际 Session grep 通过。源码运行仍使用 @vscode/ripgrep。缺失与不可执行资源通过真实工具结果返回 ripgrep-unavailable 及平台包不完整提示。
- 真实 tarball 离线安装在仓库外带空格路径，使用隔离 HOME／项目／TMPDIR，产品 PATH 仅提供 Node 和系统工具，不提供 Bun 或额外 rg。实际命令覆盖双语 help/version、参数错误、stdin、text／stream-json、真实 grep 与 bash、输出截断和 spill 清理、活 bash 进程中断清理、SIGINT130／SIGTERM143、已接受请求恢复、正常 Session Resume。直接平台二进制也在无 Node/Bun 的 PATH 下成功输出版本。
- 两个生成 manifest 使用文件白名单；安装后核对精确平台版本、os/cpu、无私有／SDK／workspace 声明、无源码测试或用户数据。MIT 项目许可与基于实际编译模块图和原生资源生成的声明随包分发；包括固定 Bun 运行时、pi、vendored renderer 与 libvips 原声明。缺失原始许可的上游条目明确记录缺失，兄弟项目文本仅标记补充，不伪造适用版权；Yoga 保留既有范围例外。
- 验证：bun run release:build --out /tmp/rukie-release-02-final 和 bun run release:accept --artifact-dir /tmp/rukie-release-02-final：10 pass／0 fail，78断言，7.14秒；Bun1.4.2、Node26.10.0、npm11.19.1，实机 darwin/arm64。最终 metadata 记录编译201ms、构建打包5784ms；信息入口用例约2秒，覆盖6次实际启动，这是真实独立执行文件／Node进程启动成本。其他安装用例均小于1秒；安装fixture和已构建tarball在suite中复用。
- 源码相关回归：bun test scripts/tests/release-notices.test.ts packages/coding-agent/tests/main.test.ts packages/agent/tests/e2e/tools.test.ts：62 pass／0 fail，2.25秒；随后许可归属文案修正的3个 generator tests通过（18ms）。额外 launcher 模拟 Linux、macOS x64 与旧 Node 的边界检查通过。main 版本期待值改为独立读取 manifest，避免 Release Please 升版后出现硬编码0.1.0假失败。
- 静态和文档：tsc -b、oxlint、knip、oxfmt --check、check:docs、docs:update、check:scratch、git diff --check 通过。未运行全量 check，集成分支统一执行。构建 metadata 标记本地未提交树 dirty=true，不能视为干净发布commit；真实CI/npm/OIDC与TUI/provider完整验收属于后续票。
- ADR coverage：沿用 ADR-0023 的单产品版本、平台包、安装验收与许可范围，ADR-0012 的原 main 共用入口和动态 Frontend，ADR-0024 锁定 pi 能力复用。原生资源定位和静态构建注册不改变 Core/Frontend 依赖方向、权限、信任或恢复语义，无新架构决定。
