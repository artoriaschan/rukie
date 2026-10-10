# 17: 桌面端打包与签名细节

Type: research

Blocked by: None

Status: needs-triage

## Question

在 [11](11-research-sidecar-packaging.md#answer) 基础上：macOS universal 还是分架构构建（Bun 单文件 sidecar 能否 lipo）；sidecar 的 entitlements 沿用 Helper 还是 `afterSign` 单独重签；发布检查如何验证 JIT 生效；本地与 CI 如何验证签名、公证与 Windows 签名。编译产物的 `rg` 查找已由 npm-release 落地为可执行文件同目录（`packages/agent/src/tools/grep.ts`），确认 sidecar 能直接复用。
