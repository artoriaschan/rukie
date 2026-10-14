---
status: accepted
---

# 浏览器形态由 sidecar 提供凭证加密、模型服务与原生能力

## 问题

`@rukie/ui` 需要在浏览器中连接本机 sidecar，用真实模型调试界面，并供后续本机 Web 产品复用（[ADR-0029](0029-desktop-package-structure.md)）。现有凭证加密依赖 Electron main 的 safeStorage 私有通道，模型服务管理经 preload IPC 和 main 持有的 management token 调用 sidecar，选择文件夹、在 Finder 中显示与在终端打开由 main 执行。浏览器形态没有 main，已保存的密文不能解密，新凭证不能加密，模型服务页面与原生入口不可用。[ADR-0035](0035-desktop-isolated-sqlite-storage.md) 禁止凭证经会话 WebSocket 传递，[ADR-0031](0031-desktop-wire-protocol-and-local-auth.md) 规定命令全部走 WS。

## 决定

适用范围是本机浏览器连接同一台机器上的 sidecar。托管、远程或多用户 Web 需要账号、服务端密钥管理与远程工具执行，不在本决定内。

### 加密后端

sidecar 的 `SecretEncryption` 后端由启动方通过私有启动通道显式选择，sidecar 不探测或回退：

- `electron`：现有 safeStorage 私有通道，Electron 正式与开发应用继续使用。
- `system-keychain`：sidecar 经 `Bun.secrets` 在系统凭据库（macOS 钥匙串、libsecret、Windows Credential Manager）保存每个安装独立的 AES-256-GCM 主密钥，用它加解密。服务名由启动方指定，与正式应用和 `dev:desktop` 的系统身份不同。
- `memory`：主密钥只在进程内存中，进程退出即失效，只用于隔离验收运行，不作为任何入口的默认值。

`app.sqlite` 仍只保存密文，供应商与凭证在同一事务提交，vault 合同不变。未选择后端、系统凭据库不可用或授权被取消时返回现有可重试错误，不明文落盘，不改用其他后端。不同后端的密文互不兼容，各自使用独立配置根。同一系统凭据 service 的消费者共享配置根，在该根内通过 SQLite 进程锁保护首次主密钥创建，并在锁内重新读取；读取失败不创建，进程退出自动释放锁，锁文件不保存密钥。

### 模型服务通道

浏览器形态的模型服务操作（列表、保存、删除、测试、显示 API Key、价格）作为会话 WS 命令提供，遵循 ADR-0031 的鉴权与校验，不另开 HTTP API。本决定部分替代 ADR-0035 中“凭证不经会话 WebSocket 传递、renderer 录入的新密钥交给 main”的规则，仅适用于 `system-keychain` 与 `memory` 后端：

- 新 API Key 明文只在 loopback WS 的保存命令中出现一次，sidecar 收到后立即加密。
- 显示 API Key 只响应用户对单个供应商的显式请求，返回值不进入 snapshot、日志或模型上下文，client 与 store 不缓存。
- `electron` 后端拒绝这些命令，Electron 继续使用 preload IPC、main 加密与 management token 通道。

### 原生能力

在 Finder 中显示与在终端打开由 sidecar 通过 WS 命令执行，Electron 与浏览器形态共用这条路径，main 不再保留对应实现。选择文件夹在浏览器形态由 sidecar 弹出系统对话框，Electron 继续使用窗口内的原生对话框。

sidecar 只对已存在的绝对路径执行这些操作；显示与终端只接受已登记项目根、无项目会话的 workspace 目录及其子路径；[ADR-0045](0045-git-worktree-sessions.md) 增加已记录的工作树目录。外部进程按参数向量启动，不经 shell，路径不拼入脚本源码。不支持的平台返回明确错误，界面退回手动填写路径。

ADR-0035 的其余数据归属、凭证安全与开发隔离规则，以及 [ADR-0036](0036-shared-development-configuration.md) 的开发配置共享规则继续有效。规格与实施工单见[浏览器开发模式 spec](../../.scratch/desktop-web-dev/spec.md)。

## 备选方案

- 浏览器形态只用 fake model：调试不了真实供应商的回复与模型服务流程，也不能为本机 Web 产品提供凭证能力。
- 浏览器形态隐藏原生入口：sidecar 本来就在本机执行工具，能完成这些操作，隐藏会让开发形态与 Web 产品偏离实际能力。
- 每个凭证直接存入系统凭据库、数据库不存密文：需要改变供应商与凭证的同事务提交语义和 vault 合同。
- 为模型服务另开 HTTP 接口：同样违反 ADR-0031，鉴权强度与 WS 相同，并多一套校验路径。
- Electron 也改用 sidecar 加密并走 WS：会改变已验收的 safeStorage 与 IPC 边界，超出浏览器形态的需要。
- 没有私有通道时自动改用系统钥匙串：违反 ADR-0035 的不回退原则，可能在 Electron 配置错误时写入另一套密文。

## 影响

浏览器形态能用真实凭证运行，后续本机 Web 产品可复用同一套 host 与 sidecar 能力。代价是存在两种加密后端和两条模型服务通道，测试需要分别覆盖；不同后端的配置不能互相读取，切换形态需要重新录入凭证。显式凭证操作可能触发系统钥匙串授权，真实系统凭据验收遵循 [testing.md 的原生验收授权边界](../testing.md#原生验收授权边界)，不由注入的假凭据库代替。
