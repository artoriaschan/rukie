# 03：`modelServices.*` wire 命令与浏览器 host 模型服务

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#wire-命令) 与 [ADR-0037](../../../docs/adr/0037-browser-host-sidecar-capabilities.md#模型服务通道)，在会话 WS 上提供模型服务命令，浏览器 host 用它们实现 `DesktopHost.modelServices`。

- [ ] `@rukie/shared` 的 `WireCommandSchema` 新增 `modelServices.list / save / delete / test / revealKey / templates / prices`；`save` 凭证为 `keep`、`delete` 或 `replace` 明文
- [ ] server 复用 `/private/model-services` 的处理逻辑，不复制；`replace` 明文立即经当前后端加密；`electron` 后端返回明确错误码拒绝
- [ ] 明文与 `revealKey` 返回值不进入日志、snapshot、错误消息或模型上下文；client 与 store 不缓存
- [ ] 浏览器 host 经 wire client 实现 `modelServices`，模型服务页面在浏览器中可用
- [ ] server wire 测试覆盖 schema、后端拒绝、同事务保存与删除、明文不外泄；ui Chromium 测试用脚本化 wire server 覆盖浏览器模型服务流程
- [ ] 更新 server、ui README 的命令与凭证通道说明
