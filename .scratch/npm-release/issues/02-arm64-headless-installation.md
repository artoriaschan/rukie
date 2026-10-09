# 02：Apple Silicon 安装包运行 Headless Session

Status: ready-for-agent
Blocked by: 01

## What to build

Apple Silicon 用户从真实 npm tarball 安装主包与 arm64 平台包后，使用 rukie 完成实际 Headless Session，无需源码仓库、外部 Bun 或另装 ripgrep。这条路径建立后续平台和发布工作的可运行基线。

## Acceptance criteria

- [ ] 使用固定 Bun 版本生成主包及 arm64 平台 tarball，产品版本、平台依赖和命令输出一致。
- [ ] 主包 launcher 通过精确版本 optionalDependencies 定位支持的平台，平台包声明 os/cpu；缺失 optionalDependencies 或不支持的平台给出明确修复提示。
- [ ] launcher 保持 cwd、环境、标准 IO、信号和退出状态；带空格的安装路径及仓库外项目目录正常工作。
- [ ] 构建适配 pi 输出捕获动态引用，不另写 pi 业务实现；工具资源不依赖源码或构建宿主绝对路径。
- [ ] arm64 `rg` 从 `@vscode/ripgrep-darwin-arm64` 复制为平台包内与 `rukie` 同目录的独立可执行文件；Agent Core grep 在编译产物中按 `realpath(process.execPath)` 所在目录定位（构建期常量区分编译产物），源码运行保留 `@vscode/ripgrep` 解析。经 npm bin 符号链接和用户软链接启动均能找到；`rg` 缺失或不可执行时返回 `ripgrep-unavailable`，提示平台包不完整。
- [ ] 编译关闭 `.env` 与 `bunfig.toml` 自动加载；项目目录含 `.env`、`bunfig.toml`（含 preload）时安装后的命令不加载它们。
- [ ] tarball 使用文件白名单，无 workspace 依赖声明、源码 bin/SDK exports、测试、凭据、用户设置或 Sessions；MIT 许可与第三方声明可从安装包读取。
- [ ] 在临时 HOME 和项目目录安装实际 tarball，经正常设置连接本地 fake provider，运行 Session 并验证 stdin、text/stream-json、参数错误、help/version 与退出码。
- [ ] 从安装后的命令验证 grep、bash 输出捕获及进程清理、中断和 Session Resume；产品子进程 PATH 不提供 Bun 或额外 ripgrep。
- [ ] Headless 执行不初始化 React/renderer；内部 workspace 开发方式和权限/project trust 语义保持一致。
- [ ] 提供可重复的本地构建、安装及验收操作，记录实际 arm64 验收和必要的编译/进程启动成本。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 1、3–13、17–19、22–23、27–32、34、47。01 提供构建与产物必须消费的产品版本契约。完整 provider/auth 覆盖由 05 交付，Yoga 沿用确认的范围例外。

## Comments

- 2026-10-09：依据桌面端 sidecar 打包调研的实测结论补充 ripgrep 旁置定位与 Bun 自动加载两条验收，见父规格实现决定 6、7。
- 2026-10-07：拆分已确认。验收以实际安装包为入口，不将源码测试成功当作发包成功。
