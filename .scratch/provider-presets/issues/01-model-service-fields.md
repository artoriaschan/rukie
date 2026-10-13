# 01：Model Service 启用与图标字段、放宽校验、删除 templates

Status: ready-for-agent

**What to build:** 按 [spec](../spec.md#model-service-数据) 和 [spec 校验](../spec.md#校验)扩展 Model Service 数据合同，放宽 server 的 URL 校验，并按 [ADR-0038](../../../docs/adr/0038-hand-maintained-provider-presets.md) 删除未被使用的 templates 链路。

- [ ] `@rukie/shared` 新增 `PROVIDER_ICONS`（`["deepseek"]`）与 `ProviderIconKey`；`ModelServiceSchema` 增加可选字段 `enabled: boolean` 和 `icon: ProviderIconKey`
- [ ] `WireModelCatalogEntry` 增加可选字段 `providerIcon`；桌面目录从服务的 `icon` 填入，终端目录不填；store 解析器接受该字段
- [ ] `createApplicationModels` 跳过 `enabled === false` 的服务，模型自身的 `enabled` 不变；Base URL 无法解析时跳过该服务，其他服务不受影响
- [ ] `app-database.ts` 删除"有模型必须有 URL"和 URL 协议、userinfo、查询串、片段校验；compat 与默认推理档位的结构校验保留
- [ ] 删除 `applicationModelTemplates` 及其导出、server 的 `templates` 操作、wire 命令 `modelServices.templates`、desktop IPC 与 preload、host 的 `templates()`、`services.catalog` 文案，以及各自的测试
- [ ] 更新 ADR-0037 中的命令列表，以及 server/ui README 中受影响的说明
- [ ] 测试：shared schema；server 接受空 URL、非法 URL 和含 userinfo 的 URL；server 拒绝非法 compat；agent 的停用跳过、非法 URL 跳过和 `providerIcon` 透传

## Comments
