# 03: 模型目录

Status: ready-for-agent

Blocked by: —

**What to build:** 用异步的 `listModelCatalog(settings)` 替换 `listModels`。每项包含 `spec`、`id`、`name`、`providerId`、`providerName`、`input`、`reasoning`、`thinkingLevels`、`contextWindow`、`custom`、`authenticated`。凭据检查用 `getAuthenticatedProviders()`，不发网络请求。更新所有调用方（TUI 的 chat 屏幕会在打开面板时等待目录加载）。见 spec「Agent Core」模型目录部分。

- [ ] 隔离 env 和 settings 下，`authenticated` 随 env 变量是否存在而变化；自定义 provider 的 `custom` 为 true
- [ ] `thinkingLevels` 与 pi 的 `getSupportedThinkingLevels` 一致；自定义模型 `reasoning: false` 时为 `["off"]`
- [ ] 调用方与测试 helper 都已切换，Knip 不再报 `listModels`
