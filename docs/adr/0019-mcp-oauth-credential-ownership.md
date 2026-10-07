---
status: accepted
---

# MCP OAuth 归 Agent Core，凭据按用户与服务器身份隔离

## 问题

HTTP MCP Server 可能要求 OAuth。各 Frontend 自行维护登录会复制协议与凭据逻辑；仅按 server 名保存 token 则可能让同名项目配置借用其他服务器的用户身份。

## 决定

Agent Core 复用锁定 pi-mcp 的 OAuth 能力，管理 callback listener、state 校验、token 交换、刷新和凭据存储。Frontend 的 MCP Interaction 负责授权页面入口、用户响应与取消。连接探测不自动打开浏览器；缺少交互回调时不暴露授权工具。

OAuth 凭据属于用户，按 server 名和 HTTP 连接配置身份隔离，身份包含 URL 与展开后的 headers；同名但地址或 headers 不同的配置不能复用凭据。凭据存放于用户私有目录，项目配置不保存 token。项目 MCP 配置要求项目受信任或用户单独明确授权该配置，单独授权不放开项目 hooks 或权限 allow。

需要授权或调用收到 401 时隐藏该服务器的业务工具，提供可用的授权入口，并在后续 Turn 更新工具集。相同服务器的并发授权共享流程。取消或失败不产生成功凭据；Headless 使用安全默认值。连接、鉴权和工具可用状态由 Core 提供查询事实，Frontend 面板不维护第二份连接状态，也不写入 Transcript。

依据：[MCP OAuth](../../.scratch/mcp-oauth/spec.md)与[连接面板](../../.scratch/mcp-panel/spec.md)。API 与配置见 [Agent README](../../packages/agent/README.md)。接受本决定不表示真实第三方账号授权已经人工验收。

## 备选方案

- 每个 Frontend 自行管理 OAuth：重复 callback、刷新和凭据策略，Headless 与子代理难以保持同一行为。
- 按 server 名共享凭据：同名异址配置可能取得不属于它的用户授权。
- 使用系统钥匙串、跨进程刷新锁和完整撤销管理：规格明确留在本轮范围之外。

## 影响

Core 承担授权生命周期与私有文件管理；Frontend 承担交互入口。URL 或 headers 变化可能要求重新授权；当前文件存储不提供系统钥匙串或跨进程刷新协调保证。
