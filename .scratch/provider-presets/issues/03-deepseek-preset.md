# 03：供应商预设模块与 DeepSeek 三协议变体

Status: resolved

Blocked by: 01

**What to build:** 按 [spec 供应商预设](../spec.md#供应商预设)新建手工维护的预设模块，填入 DeepSeek 三个变体，并用 schema 测试和 payload 测试锁定数据与实际请求。

- [x] `packages/ui/src/lib/provider-presets/`：类型 `ProviderPreset`、`deepseek.ts`、`index.ts` 有序导出；模块 JSDoc 写明新增供应商的四步
- [x] DeepSeek 数据按 spec 两张表填写，每个变体注明来源与核对日期 2026-10-12；Anthropic 与 Responses 变体设 `off: null`；`defaultApi` 为 `anthropic-messages`
- [x] 预设名称与 API Key 获取链接的展示文案补齐 zh 和 en（`model-service-copy.ts`）
- [x] 测试：每个预设的每个变体都通过 `ModelServiceSchema` 与 `ModelCompatSchemas[api]`；`defaultApi` 存在于 variants；变体内模型 id 唯一；`icon` 属于 `PROVIDER_ICONS`；`modelServiceThinkingLevels` 对每个模型给出 spec 规定的档位
- [x] Payload 测试（agent 包）：通过 fake fetch 截取 `createApplicationModels` 发出的请求体，用预设数据覆盖三个变体、`automatic` 与 `high` 两个档位。断言 Anthropic 带 `thinking.type: "adaptive"` 与 `output_config.effort`、不带 `budget_tokens`；Chat Completions 带 `thinking` 与 `reasoning_effort`；Responses 带 `reasoning.effort`；`automatic` 档位下没有任何推理字段。预设数据从 ui 复制成测试夹具，或者在测试中构造等价的 `ModelService`，不让 agent 依赖 ui

## Comments

- 2026-10-13: 03 fresh implementer claimed; preset module, copy and independent agent payload fixtures implemented. Schema Node and fake-fetch Bun payload evidence recorded in `/tmp/rukie-provider-presets-evidence/verification.md`; final integrated review/acceptance remains with owner.

### 集成交付验收（2026-10-13）

功能范围内实现、消费者、文档和四项评审修复完成。证据见 [验证记录](../verification.md)：桌面 150 个用例组合通过，定向 payload/schema/server/icon/布局与 Chromium 验收通过；完整 Bun 实际 3507 通过 / 25 失败，混合 TUI 失败未分类，其他失败家族有独立基线/环境证据。CI 待验收，真实接口及正式 Electron 待用户验收，resolved 不表示全量接受或已合并。
