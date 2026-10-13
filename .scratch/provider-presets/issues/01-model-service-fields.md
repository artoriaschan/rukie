# 01：Model Service 启用与图标字段、放宽校验、删除 templates

Status: resolved

**What to build:** 按 [spec](../spec.md#model-service-数据) 和 [spec 校验](../spec.md#校验)扩展 Model Service 数据合同，放宽 server 的 URL 校验，并按 [ADR-0038](../../../docs/adr/0038-hand-maintained-provider-presets.md) 删除未被使用的 templates 链路。

- [x] `@rukie/shared` 新增 `PROVIDER_ICONS`（`["deepseek"]`）与 `ProviderIconKey`；`ModelServiceSchema` 增加可选字段 `enabled: boolean` 和 `icon: ProviderIconKey`
- [x] `WireModelCatalogEntry` 增加可选字段 `providerIcon`；桌面目录从服务的 `icon` 填入，终端目录不填；store 解析器接受该字段
- [x] `createApplicationModels` 跳过 `enabled === false` 的服务，模型自身的 `enabled` 不变；Base URL 无法解析时跳过该服务，其他服务不受影响
- [x] `app-database.ts` 删除"有模型必须有 URL"和 URL 协议、userinfo、查询串、片段校验；compat 与默认推理档位的结构校验保留
- [x] 删除 `applicationModelTemplates` 及其导出、server 的 `templates` 操作、wire 命令 `modelServices.templates`、desktop IPC 与 preload、host 的 `templates()`、`services.catalog` 文案，以及各自的测试
- [x] 更新 ADR-0037 中的命令列表，以及 server/ui README 中受影响的说明
- [x] 测试：shared schema；server 接受空 URL、非法 URL 和含 userinfo 的 URL；server 拒绝非法 compat；agent 的停用跳过、非法 URL 跳过和 `providerIcon` 透传

## Comments

### Implementation evidence (2026-10-13)

- Fresh implementer in `feat/provider-presets-01`; status remains claimed pending independent review and integration acceptance.
- Added closed shared icon keys and optional service enablement; desktop catalogs carry saved icon keys, terminal catalogs omit the field, and store rejects unknown keys. Disabled services and unparseable URLs are omitted without changing per-model enablement.
- Database accepts arbitrary Base URL strings while compat and default thinking validation remain. Removed templates from Agent Core, private/wire server operations, desktop IPC/preload, browser host, fixtures/tests and copy; updated ADR-0037 and server/ui README facts.
- TDD red/green: wire schema rejected the new valid fields before schema change; storage rejected all relaxed URL examples before validation removal; runtime catalog retained disabled/invalid services before filtering; icon absent before metadata addition; store accepted unknown icon before guard.
- `bun test packages/server/tests/wire.test.ts packages/server/tests/storage/app-database.test.ts packages/agent/tests/config/application-models.test.ts packages/server/tests/server.test.ts`: 46 passed, 0 failed, 2.11s; all individual cases <1s. Added server icon restart assertion afterward and focused `bun test packages/server/tests/server.test.ts -t 'private provider management persists'`: 1 passed, 191ms.
- From `packages/ui`, `bunx --no vitest run tests/store/desktop.test.ts tests/app/host.browser.test.tsx`: 16 passed, 4.58s, Node store and real Chromium scripted host. From `packages/desktop`, `bunx --no vitest run tests/preload.test.ts tests/main/desktop.test.ts`: preload 1 passed, 122ms (second filter had no matching file).
- Aggregate static, package desktop acceptance, documentation checks and GUI acceptance are coordinated by the integration owner; no real Electron or credentials used. Formatting-only changes preserve focused evidence.

### 集成交付验收（2026-10-13）

功能范围内实现、消费者、文档和四项评审修复完成。证据见 [验证记录](../verification.md)：桌面 150 个用例组合通过，定向 payload/schema/server/icon/布局与 Chromium 验收通过；完整 Bun 实际 3507 通过 / 25 失败，混合 TUI 失败未分类，其他失败家族有独立基线/环境证据。CI 待验收，真实接口及正式 Electron 待用户验收，resolved 不表示全量接受或已合并。
