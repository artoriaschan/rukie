# 02：`@lobehub/icons` 与 ProviderIcon

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec 图标依赖](../spec.md#图标依赖)引入 `@lobehub/icons`，由 `ProviderIcon` 统一渲染服务图标，替换手写 SVG 和别名推断。

- [ ] 安装 `@lobehub/icons@5.23.0`（精确锁定），不安装 `antd` 与 `@lobehub/ui`；检查 bun 关于缺失 peer 的提示不影响安装与构建，必要时在配置中做窄范围说明
- [ ] `provider-icon.tsx` 改为入参 `icon?: ProviderIconKey`，通过 `Record<ProviderIconKey, { mono, color }>` 穷尽映射，深导入 `es/DeepSeek/components/Mono` 与 `Color`；缺省使用 lucide `Box`；需要模块声明时补齐并注明原因
- [ ] 删除手写的 deepseek/openai/zhipu SVG 与别名表
- [ ] 模型选择器（`model-picker.tsx`）使用 `entry.providerIcon`；设置页供应商列表与详情头部使用服务的 `icon`
- [ ] 确认深导入只经由 `provider-icon.tsx`，knip 与 lint 通过
- [ ] 更新 `docs/tech-stack.md`（界面一节）和 lockfile；DESIGN.md "Conversation model controls"中 Brand paths 相关的描述改为 `ProviderIcon` 和 `icon` 键
- [ ] 测试：Chromium 断言 DeepSeek 服务在三处渲染品牌图标，没有 `icon` 的服务显示 Box；图标有可访问名称或标记为装饰性，与周围文本一致

## Comments
