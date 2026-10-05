# 03: 自定义模型 `input` 字段

**What to build:** 用户在 settings 中为自定义 provider 模型声明 `input: ["text","image"]` 后，该模型收到图片；未声明的模型保持纯文本。frontend 可从 `listModels` 得知模型是否接受图片。详见 [图片输入 spec](../spec.md) 的自定义 provider 模型与非视觉模型两节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 自定义模型 schema 增加可选 `input`：`"text" | "image"` 非空数组且含 `"text"`，缺省 `["text"]`；非法值按现有 settings 校验报错
- [ ] `listModels` 结果增加 `input`（内置模型取 pi-ai 数据）
- [ ] settings 单测：合法值、缺省、空数组、缺 `"text"`、未知值；`listModels` 带 `input`
- [ ] e2e：声明 image 的自定义模型请求中有图片；缺省时请求中为 pi-ai 占位文本（read 工具产生的图片即可验证，不依赖 01）
