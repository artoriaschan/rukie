# 11: Bun sidecar 的打包与分发

Type: research

Blocked by: None

Status: resolved

## Question

electron-builder 26.15.3 如何携带 Bun sidecar：`bun build --compile` 按平台出单文件，还是附带 Bun 运行时加源码？内置 ripgrep 等原生资源（见 `.scratch/headless-agent/bundled-ripgrep.md`）与 ADR-0023 npm 分发如何复用？macOS 签名、公证与 `@electron/fuses` 对子进程二进制有哪些要求？

## Answer

完整调研：[research/sidecar-packaging.md](../research/sidecar-packaging.md)。在 macOS arm64 + Bun 1.4.2 上实测，临时文件已清理。

- 构建：每平台 `bun build --compile` 单文件，经 `extraResources` 放到 `Contents/Resources/sidecar/`，不进 asar（asar 内无法 spawn）。产物只链接系统库，arm64 可交叉编译 x64；`lipo` universal 在 arm64 可运行，x64 一半未实测。
- ripgrep：编译产物内 `import("@vscode/ripgrep")` 必然失败（路径指向 Bun 虚拟文件系统），嵌入 `rg` 也无法执行。`rg` 作为独立文件放在 sidecar 旁，grep 工具接收其绝对路径。ADR-0023 的 npm 分发有同样问题，桌面端与 npm 包共用一套资源布局与查找方式，需与 npm-release 02/03 协调。
- macOS：必须带 `com.apple.security.cs.allow-jit`，单独即足够。缺失时不崩溃，Bun 静默失去 JIT，慢约 12 倍（12137 ms 对 1077 ms），发布检查需验证 JIT 或性能而非仅启动。electron-builder 自内向外签名 `Contents/` 下所有二进制，默认开启 hardened runtime；`@vscode/ripgrep` 的 `rg` 只有 ad-hoc 签名，需用 Developer ID 重签。真实 Developer ID 签名与公证未测。
- Windows：`extraResources` 中的 `.exe` 在复制时自动签名，需要 EV 证书或 Azure Trusted Signing。未在 Windows 实测。
- Fuses：只作用于 Electron 可执行文件，不约束 sidecar。electron-builder 的 `electronFuses` 配置使用自带的 `@electron/fuses ^1.8.0`；要用 tech-stack 锁定的 2.0.0，需在 `afterPack` 自行调用。
- sidecar 加固缺口（已实测）：`BUN_BE_BUN=1` 让已签名、带 JIT 的二进制执行任意代码；`BUN_OPTIONS` 注入运行时参数；默认从 cwd 加载 `.env` 与 `bunfig.toml`（对 coding agent 即不受信任的项目目录）。缓解：编译加 `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`，main 启动 sidecar 时剔除 `BUN_BE_BUN`、`BUN_OPTIONS`、`DYLD_*`、`NODE_OPTIONS`。这是缓解而非完整修复。
- 未定：universal 还是分架构构建；sidecar 沿用 Electron Helper 的 entitlements 还是在 `afterSign` 单独重签。
