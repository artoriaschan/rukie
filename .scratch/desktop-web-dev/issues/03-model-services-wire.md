# 03：`modelServices.*` wire 命令与浏览器 host 模型服务

Status: claimed

Blocked by: 01

**What to build:** 按 [spec](../spec.md#wire-命令) 与 [ADR-0037](../../../docs/adr/0037-browser-host-sidecar-capabilities.md#模型服务通道)，在会话 WS 上提供模型服务命令，浏览器 host 用它们实现 `DesktopHost.modelServices`。

- [x] `@rukie/shared` 的 `WireCommandSchema` 新增 `modelServices.list / save / delete / test / revealKey / templates / prices`；`save` 凭证为 `keep`、`delete` 或 `replace` 明文
- [x] server 复用 `/private/model-services` 的处理逻辑，不复制；`replace` 明文立即经当前后端加密；`electron` 后端返回明确错误码拒绝
- [x] 明文与 `revealKey` 返回值不进入日志、snapshot、错误消息或模型上下文；client 与 store 不缓存
- [x] 浏览器 host 经 wire client 实现 `modelServices`，模型服务页面在浏览器中可用
- [x] server wire 测试覆盖 schema、后端拒绝、同事务保存与删除、明文不外泄；ui Chromium 测试用脚本化 wire server 覆盖浏览器模型服务流程
- [x] 更新 server、ui README 的命令与凭证通道说明

## Implementation evidence

Owner: ticket 03 implementer; pre-agreed seams: shared command parsing, authenticated public server WS, and Chromium App with scripted WS boundary. Root coordinates aggregate static/desktop and final isolated acceptance. TDD initial WS save red returned invalid_command; green case passed in 30.86 ms.

共用 `modelOperation` 保留 private HTTP 的操作/错误语义，wire replacement 先加密再调用相同保存事务；Electron 显式返回 `model_services_unavailable`。浏览器 `DesktopHost` 完整必需，App 始终显示设置入口，模型服务不再判断隐藏能力；host 复用 `bindClient` 唯一 WS，响应校验且不保存明文。测试 fixture 补齐相同接口，外部价格查询与真实凭证均未访问。

验证：`bun test packages/server/tests/server.test.ts packages/server/tests/wire.test.ts` 35/35，5.87 s；新增 save/keep/delete、后端拒绝、异常脱敏为 11–50 ms。snapshot 覆盖增补后 focused 用例 209.13 ms。Chromium host 文件 4/4，5.18 s；模型服务/shell/layout 34 个案例首跑 33/34，必需价格探测新增状态文案让旧标题断言失败，改为只断言标题文本节点，focused 回归通过（2.98 s）。host 全方法补充后 focused Chromium 通过（3.01 s）。这些 browser 时长来自真实 Chromium、脚本化 WS 子进程与顺序点击，无固定 sleep。`bunx --no tsc -b`、focused `oxlint`、oxfmt 和 `git diff --check` 通过。根代理复用上述有效证据并负责完整静态、desktop 包级和最终浏览器验收。

ADR Coverage review: 与 spec 的 ADR-0037 模型服务 WS / 后端拒绝边界、ADR-0031 鉴权命令及 ADR-0029 host→client 方向一致；复用现有数据库凭证事务与历史行为，不新增架构取舍。README 已同步当前凭证通道。保持 claimed，待集成评审与根代理适用验证后一起 resolved。

Chromium settings tracer 在基线 browserHost/App 下重放，缺少 Model services 按钮失败；恢复实现后上方 3.01 s green 证据有效。Snapshot 非泄露断言在仍保存凭证时执行，最终 focused green 155.26 ms。文档检查 146 Markdown 文件通过。
