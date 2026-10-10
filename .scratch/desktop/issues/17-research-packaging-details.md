# 17: 桌面端打包与签名细节

Type: research

Blocked by: None

Status: resolved

## Question

在 [11](11-research-sidecar-packaging.md#answer) 基础上，只针对本地构建 macOS arm64 的 ad-hoc 签名 `.app`（[03](03-mvp-scope.md#comments) 2026-10-10）：electron-builder 跳过 Developer ID 签名时如何对 Electron、sidecar 与 `rg` 做 ad-hoc 签名；ad-hoc 签名加 hardened runtime 时 `allow-jit` 是否仍让 sidecar 保持 JIT，sidecar 的 entitlements 沿用 Helper 还是 `afterSign` 单独重签；本地构建脚本如何验证 JIT 生效；本机打开未公证 `.app` 时 Gatekeeper 的行为。编译产物的 `rg` 查找已由 npm-release 落地为可执行文件同目录（`packages/agent/src/tools/grep.ts`），确认 sidecar 能直接复用。

## Answer

- 完整调研：[research/local-macos-packaging.md](../research/local-macos-packaging.md)。2026-10-10 在 macOS 27.0.1 arm64 上用 Electron 41.0.3、electron-builder 26.15.3 与 Bun 1.4.2 实测，临时文件和进程已清理。
- 签名：配置 `mac.identity: "-"`。osx-sign 对 `Contents/` 下所有 Mach-O（包括 `Resources/sidecar/` 中的 sidecar 与 rg）由深到浅执行 ad-hoc + hardened runtime 签名，`codesign --verify --deep --strict` 通过。`identity: null` 或未设置时会跳过签名，`afterSign` 也不执行，外层封印缺失，strict 校验失败。arm64 上未签名的 Mach-O 会被 SIGKILL。
- Electron：ad-hoc 签名加 hardened runtime 时，`entitlements` 与 `entitlementsInherit` 必须带 `disable-library-validation`，否则启动时无法加载 Electron Framework（退出码 134）。
- JIT：sidecar 只需 `allow-jit`。由 Electron main spawn 时，带 `allow-jit` 约 0.96 s；hardened runtime 但不带 `allow-jit` 约 6.3 s，且 `numberOfDFGCompiles` 为 1000000；不加 hardened runtime 约 0.97 s。缺少 `allow-jit` 不会报错，只会变慢。
- entitlements：推荐 `afterSign` 重签。sidecar 只带 `allow-jit`，rg 不带 entitlements，再用 `--preserve-metadata=entitlements,identifier,flags` 重新封印外层 `.app`（实测通过 strict 校验），Helper 继续使用 inherit。
- 验证：构建脚本依次检查 strict 校验、sidecar flags 含 `runtime` 且 entitlements 含 `allow-jit`，然后执行 `BUN_BE_BUN=1 <sidecar> -e <probe>`，断言 `numberOfDFGCompiles(f) !== 1000000`。可用 `BUN_JSC_useJIT=0` 构造负例。
- Gatekeeper：本机构建的文件没有 `com.apple.quarantine`，直接运行和 `open` 都能启动。`spctl --assess` 对 ad-hoc 签名一律 `rejected`，不能作为验收项。手动加上 quarantine 后从 shell 执行被 SIGKILL，`xattr -d` 后恢复。Finder 首次打开时的对话框流程未实测。
- rg：sidecar 编译时注入 `RUKIE_COMPILED=true`，即可直接复用 grep.ts 的 `realpath(process.execPath)` 同目录查找，`.app` 内实测可用。rg 必须取自锁定的 `@vscode/ripgrep-darwin-arm64`（Homebrew rg 依赖外部 pcre2 dylib，在 hardened runtime 下无法加载）。编译产物的 `ripgrep-unavailable` 提示写的是 npm 平台包，对桌面端需另行调整。
