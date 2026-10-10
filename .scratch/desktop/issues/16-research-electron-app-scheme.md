# 16: Electron app:// 协议的文件服务与 Origin 复核

Type: research

Blocked by: None

Status: needs-triage

## Question

在锁定的 Electron 41.0.3 上：`protocol.handle` 注册 standard + secure 的 `app://rukie` 并提供 Vite 构建产物的推荐方式（[06](06-research-local-server-auth.md#answer) 实验中 `loadURL` 报 `ERR_FAILED (-2)`）；WS 握手的 Origin 是否为 `app://rukie`；CSP、SPA 路由回退与 fuses（`GrantFileProtocolExtraPrivileges` 等）的配合。
