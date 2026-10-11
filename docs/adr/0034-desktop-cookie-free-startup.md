---
status: accepted
---

# 桌面端不使用 Cookie 存储，关闭未使用的 Cookie Encryption 初始化

## 问题

Electron 的 Cookie Encryption 会在 macOS 启动时访问钥匙串。当前本地 ad-hoc 签名构建更新后可能再次请求访问「rukie-desktop Safe Storage」，导致聊天窗口启动前出现密码授权。桌面端没有 Cookie 使用方，也没有调用 Electron safeStorage；连接鉴权由 [ADR-0031](0031-desktop-wire-protocol-and-local-auth.md) 的一次性 WS token 完成。

## 决定

桌面端不在 Cookie 中存储凭据或 Session 状态。生产打包关闭 `EnableCookieEncryption`，构建脚本在最终签名产物中读回并验证该 fuse 已关闭。其余 sandbox、context isolation、asar 完整性与签名约束保持有效。

Agent Core 继续拥有用户配置和 Session 存储，Electron 不接管这些数据。启动验收使用隔离 HOME 与 user-data，直接运行签名 app，不使用 mock keychain 掩盖钥匙串初始化。

## 备选方案

- 保留 Cookie Encryption 并要求用户授权：当前没有 Cookie 需求，却引入启动密码提示；ad-hoc 构建的身份变化还可能导致重复授权。
- 在生产中使用 mock keychain 参数：这是测试替身，会掩盖真实系统行为，不能作为实际存储策略。
- 仅更换稳定的 Developer ID 签名：可以改善更新后的授权识别，但当前本地构建没有正式签名与分发范围，也不应为未使用的 Cookie 访问钥匙串。

## 影响

当前桌面启动不再因 Cookie 加密初始化访问钥匙串。关闭该 fuse 意味着 Electron Cookie 数据库没有这层加密，因此未来引入 Cookie、safeStorage 或其他凭据持久化前必须重新确定存储和签名方案。已有加密 Cookie 的兼容迁移不在范围内；当前 Rukie 没有此类业务数据，Session 和用户配置由 sidecar 管理，不受该 fuse 影响。

[桌面 README](../../packages/desktop/README.md) 说明当前构建和启动验收；[issue 30](../../.scratch/desktop/issues/30-local-macos-build.md) 保存原打包证据与后续修正。
