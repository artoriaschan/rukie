# 17: 桌面端打包与签名细节

Type: research

Blocked by: None

Status: needs-triage

## Question

在 [11](11-research-sidecar-packaging.md#answer) 基础上，只针对本地构建 macOS arm64 的 ad-hoc 签名 `.app`（[03](03-mvp-scope.md#comments) 2026-10-10）：electron-builder 跳过 Developer ID 签名时如何对 Electron、sidecar 与 `rg` 做 ad-hoc 签名；ad-hoc 签名加 hardened runtime 时 `allow-jit` 是否仍让 sidecar 保持 JIT，sidecar 的 entitlements 沿用 Helper 还是 `afterSign` 单独重签；本地构建脚本如何验证 JIT 生效；本机打开未公证 `.app` 时 Gatekeeper 的行为。编译产物的 `rg` 查找已由 npm-release 落地为可执行文件同目录（`packages/agent/src/tools/grep.ts`），确认 sidecar 能直接复用。
