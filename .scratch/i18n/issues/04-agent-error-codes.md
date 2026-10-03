# 04: Agent Core 错误码与英文拒绝原因

Status: ready-for-agent

**What to build:** Agent Core 不再产出中文（ADR-0008）。ripgrep 不可用、未配置模型、未知模型、缺少 API key、session 不存在这五种错误在 TUI 中按 locale 显示；模型收到的工具拒绝原因固定英文，transcript 不含界面语言。见 spec Implementation Decisions 的 `@neant/shared`、Agent Core、TUI（错误展示）节。

**Blocked by:** 01

- [ ] `@neant/shared` 新增用户可见错误码联合类型与带码错误形状 `{ code, params }`：`ripgrep-unavailable`（cause）、`no-model`（settings 路径）、`unknown-model`（model）、`no-api-key`（provider、env）、`session-not-found`（id）
- [ ] Agent Core 上述五处抛出带 `code` / `params` 的错误，`message` 英文
- [ ] 权限拒绝 reason 改英文（auto-review 下用户拒绝、未授权两种）
- [ ] `@neant/i18n` 通用文案补齐五个错误码 zh / en，类型上与错误码联合类型绑定，漏写报错
- [ ] TUI 展示 Agent Core 错误：带码查通用文案，不带码显示原 `message`
- [ ] Agent Core 不依赖 `@neant/i18n`，不引入 locale 参数
- [ ] 测试：agent permissions / tools / config 测试断言英文 reason 与正确 `code` / `params`；TUI e2e 覆盖带码错误在 zh / en 下的文本、不带码错误原样显示
- [ ] `tsc -b` 与全部测试通过
