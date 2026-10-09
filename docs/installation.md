# 安装与升级 Rukie

Rukie 的 npm 产品是命令行包 `@rukie/coding-agent`，支持 macOS Apple Silicon（arm64）。安装和 launcher 需要 Node.js24.15.0 或更新版本及 npm；平台可执行文件内置 Bun，用户不需要安装 Bun、额外 ripgrep 或 Python。macOS Intel、Linux 和 Windows 当前不受支持；内部 Agent Core 等 workspace 不单独公开，产品没有 SDK exports。工具与支持边界归属[技术栈](tech-stack.md)和[分发架构](adr/0023-npm-cli-distribution.md)。

以下命令适用于维护者已完成对应 registry 发布的版本；本地发布实现和 GitHub Release 的存在不表示包已经可以从 npm 安装。

## 稳定版和 beta

```sh
npm install --global @rukie/coding-agent@latest
rukie --version
rukie --help
```

默认稳定安装使用 latest，经维护者的 registry 安装验收后推进。升级时重新执行同一命令，再核对 `rukie --version`；固定诊断版本可使用 `npm install --global @rukie/coding-agent@0.1.0`，版本需确实已发布。

beta 使用独立 next 通道：

```sh
npm install --global @rukie/coding-agent@next
rukie --version
```

返回稳定通道时重新安装 `@rukie/coding-agent@latest`。主包通过精确 optionalDependencies 安装同版本 arm64 平台包；不要使用 `--omit=optional`。平台包缺失、版本不符或不可执行时，launcher 会给出修复提示：重新启用 optionalDependencies 并安装同一个主包版本。

## 使用命令

`rukie --help` 和 `rukie --version` 无需 provider 凭据或交互终端，不初始化 Session。在准备好现有 provider 用户设置后，从项目目录运行 `rukie` 使用 TUI，或运行 `rukie -p "任务"` 使用 Headless CLI；设置、provider 与 auth 的实际支持边界见[provider 参考](release-providers.md)和[Headless README](../packages/coding-agent/src/headless/README.md)。

launcher 保留工作目录、环境变量、标准 IO 和信号。产品数据继续属于用户 HOME 中的 Rukie 配置与 Sessions；升级仍使用现有用户配置与 Sessions。TUI 正常退出恢复终端并显示可见的 Resume 命令，使用 `rukie --resume SESSION_ID` 恢复原 Session。首次在项目中执行 hooks/MCP 等能力仍遵循项目信任和权限规则。

维护者的原始 tarball 构建与离线安装验收见[构建指南](release-building.md)；发布、恢复与回退见[维护者发布指南](release-publication.md)。
