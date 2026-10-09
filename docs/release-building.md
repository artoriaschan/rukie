# 构建与验收 npm 安装包

本地分发提供 `@rukie/coding-agent` 主包和 `@rukie/coding-agent-darwin-arm64` 平台包，用户命令为 `rukie`。当前支持 macOS arm64（Apple Silicon）；macOS Intel 和其他平台得到明确的不支持提示。内部 workspace 包保持私有，分发包没有 SDK exports。分发决定见 [ADR-0023](adr/0023-npm-cli-distribution.md)，产品版本来自 [coding-agent manifest](../packages/coding-agent/package.json)。

## 前提与构建

在 macOS arm64 使用 [.bun-version](../.bun-version) 指定的 Bun 1.4.2、Node.js 24.15.0 或更新版本及 npm。Bun 只用于维护者构建和测试；安装后的主包需要 Node，平台可执行文件内置 Bun，可直接运行而无需 Node 或外部 Bun。锁定的 JS 与原生依赖见[技术栈](tech-stack.md)。

从仓库根目录运行：

```sh
bun install --frozen-lockfile
bun run release:build --platform darwin-arm64 --out dist/release
bun run release:verify --artifact-dir dist/release
bun run release:accept --artifact-dir dist/release
```

构建命令验证宿主架构与 Bun 版本，将原始产品入口及 sixel worker 编译为独立执行文件，生成两个仅含许可、声明、launcher 或平台资源的白名单 manifest，然后通过 `npm pack` 生成真实 tarball。`dist/release/release-build.json` 记录产品版本、构建时 Git commit、是否存在未提交改动、实际工具版本及 tarball SHA-256／SHA-512；本地未提交构建的 `dirty` 标记不能被解释为该 commit 的干净发布产物。默认输出在被忽略的 `dist/` 下；`--out` 必须指向维护者拥有的输出目录，其 `staging/` 会在重新构建时替换。

构建平台通过 `--platform` 指定；当前唯一可选值为 `darwin-arm64`，对应的编译目标、平台包名称、CPU 和原生资源来自 [平台描述](../scripts/release/platforms.ts)，不按宿主架构猜测 ripgrep。增加目标须先增加描述和该架构的实际安装验收；launcher 根据主包的精确 optionalDependencies 选择目标，Frontend 与 Session 执行入口共用。

本地构建和验收不写 registry，不表示 GitHub CI、Trusted Publisher、真实远程 OAuth 或 npm 发布已经成功。首个正式发布需要单独明确操作。

## 安装与运行

在仓库外同时安装生成的两个 tarball，避免本地验收依赖 registry 中尚不存在的平台版本：

```sh
npm install --prefix "/tmp/rukie local install" --offline --ignore-scripts --no-audit --no-fund \
  "$PWD/dist/release/rukie-coding-agent-darwin-arm64-0.1.0.tgz" \
  "$PWD/dist/release/rukie-coding-agent-0.1.0.tgz"
"/tmp/rukie local install/node_modules/.bin/rukie" --help
"/tmp/rukie local install/node_modules/.bin/rukie" --version
```

文件名中的版本需与本次构建 metadata 一致。主包的 optionalDependencies 精确引用同一产品版本；缺失、版本不符或不可执行的平台资源会提示重新启用 optionalDependencies 安装。launcher 根据 `LC_ALL`、`LC_MESSAGES`、`LANG` 的优先级使用中文或英文诊断。macOS x64、Linux 与 Windows 在启动产品前返回非零状态，并列出已支持目标；主包不声明 Intel 平台依赖。launcher 在检查 Node 最低版本和平台资源后使用 POSIX `process.execve` 替换自身，保留 cwd、环境、标准 IO 与进程身份；终端信号只有一个产品进程接收。Node 24 的 execve 仍属实验 API；24.x 最低版本为 24.15.0，更新主版本也受支持。产品 Headless 参数、退出状态和恢复合同见 [Headless README](../packages/coding-agent/src/headless/README.md)。

`release:accept` 将实际 tarball 离线安装到仓库外包含空格的临时路径，每个验收 suite 使用独立 HOME、项目目录和 TMPDIR。子进程 PATH 只提供 Node 与系统命令，不提供 Bun 或额外 ripgrep；本地模型 HTTP fixture 驱动真实 Session。验收通过正常命令验证信息入口、双语输出、参数错误、stdin、text／stream-json、grep、bash 输出捕获、spill 清理、信号中断及 Session Resume。等待依赖 HTTP、文件事件和进程退出，超时只限制失败等待；真实进程和编译成本不能通过父进程虚拟时钟消除。

## 核对产物身份

`release:verify` 读取 `release-build.json` 和实际 tarball；它不信任 `staging/` 中的副本。校验涵盖 metadata 字段与工具版本、产品版本和源 manifest、commit 对象、tarball SHA-256／SHA-512、文件白名单、同版本平台依赖、两份许可声明，以及 `rukie`／`rg` 的 arm64 Mach-O 标头和执行权限。`rg` 与 sharp／libvips 的内容须匹配描述中显式选择的锁定平台资源；缺文件、Intel 依赖或版本漂移会使命令失败。安装验收先执行同一校验，再从 tarball 安装并核对实际 `--version` 与 Session 行为。

本地开发允许真实记录的 `dirty: true`，这仅表示工作目录产物。正式发布必须传入已审阅 commit 并启用干净构建要求：

```sh
bun run release:verify --artifact-dir dist/release --require-clean --commit "$(git rev-parse HEAD)"
```

该命令拒绝 dirty metadata 或不同 commit；发布阶段应提供 tag 对应的准确 SHA，而不是使用其他分支的 HEAD。校验通过不代替匹配架构上的安装验收，不表示外部 CI 或 npm 已完成。校验脚本的公开入口见 [verify.ts](../scripts/release/verify.ts)，后续 CI 与发布操作复用同一入口。

## 资源与许可

平台包 `bin/rukie` 的同目录包含 `rg` 及 `native/@img/`。编译产物的 grep 使用构建期常量选择 `realpath(process.execPath)` 同目录的 `rg`；源码运行继续经 `@vscode/ripgrep` 解析。npm bin 链接和用户软链接都不会改变资源目录。`rg` 缺失或不可执行产生 `ripgrep-unavailable`，说明平台包不完整。

头像 PNG 嵌入执行文件；真实 sharp JS 能力保持原样，构建 adapter 只将原生 addon 定位到同目录的固定资源布局，libvips 沿上游相对目录加载。原始 sixel worker 作为附加编译入口保留。release builder 静态注册锁定 pi 的 OAuth flows 和 Bedrock provider；没有添加第二条 Session 业务执行路径。当前 bash 输出捕获属于 Rukie 自有模块，不使用旧 pi capture shim。

编译关闭 `.env`、`bunfig.toml`、`tsconfig.json` 与 `package.json` 的运行时自动加载。用户工作目录中的 Bun preload 不会改写产品配置或执行代码；显式传入的环境变量仍完整保留。产品设置继续由现有用户设置、项目信任和权限机制控制。

两个 tarball 都携带项目 [MIT 许可](../LICENSE) 和第三方声明。声明根据实际编译模块图及手工列明的 rg／sharp／libvips 资源生成，包含固定 Bun 运行时及 vendored renderer 的上游原始声明，并明确列出部分 npm 包缺少原始 notice 或声明不一致的事实；同仓库包的补充文本不构成该包版权归属的证明。执行文件包含的第三方代码按各自声明列明。Yoga 维持 [ADR-0013](adr/0013-adopt-dsh-tui-ink.md) 与 ADR-0023 的既有来源和用户确认范围，本次不调查或替换其来源。
