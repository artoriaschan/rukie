# 03: 自定义模型 `input` 字段

**What to build:** 用户在 settings 中为自定义 provider 模型声明 `input: ["text","image"]` 后，该模型收到图片；未声明的模型保持纯文本。frontend 可从 `listModels` 得知模型是否接受图片。详见 [图片输入 spec](../spec.md) 的自定义 provider 模型与非视觉模型两节。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 自定义模型 schema 增加可选 `input`：`"text" | "image"` 非空数组且含 `"text"`，缺省 `["text"]`；非法值按现有 settings 校验报错
- [x] `listModels` 结果增加 `input`（内置模型取 pi-ai 数据）
- [x] settings 单测：合法值、缺省、空数组、缺 `"text"`、未知值；`listModels` 带 `input`
- [x] e2e：声明 image 的自定义模型请求中有图片；缺省时请求中为 pi-ai 占位文本（read 工具产生的图片即可验证，不依赖 01）

## Comments

- 2026-10-06：在 `codex/image-input-03` 上以集成分支 `codex/image-input` 的 `4b58bb1` 为基线完成。settings schema 校验非空 `text` / `image` 数组且必须包含 `text`；模型注册保留声明，省略时默认 `text`；`listModels` 返回每个模型的 `input`，内置值沿用 pi-ai。
- TDD：先观察 `loadSettings` 接受仅 `image` 的非法声明而失败，再增加 schema；模型列表的 `input` 断言在旧接口上失败。真实协议回归在旧的固定 `input: ["text"]` 注册行为下出现 1 pass / 1 fail：视觉模型收到降级占位；传入声明后两个案例通过。
- 验证：`rtk proxy bun test packages/agent/tests/config/settings.test.ts packages/agent/tests/e2e/custom-model-input.test.ts packages/agent/tests/e2e/model-switch.test.ts` → 54 pass / 0 fail（91 assertions）。本地 OpenAI fake endpoint 通过 `createSession` 和 read 工具验证视觉请求带 PNG、缺省请求带 pi-ai 占位文本且不发送 base64，两个 Transcript 都保留图片；不依赖工单 01。
- 检查：`rtk proxy bunx --no -- tsc -b`、改动 TS 文件的 `oxlint`、`oxfmt` 与 `rtk git diff --check` 通过。全部 spec 合并后的 `env -u NO_COLOR bun run check` 由集成分支执行。
