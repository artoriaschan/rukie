---
status: accepted
---

# Provider Preset 由 Rukie 手工维护，生成的 Model Service 与预设无执行关联

## 问题

桌面端添加供应商只有自定义入口（[桌面存储 spec](../../.scratch/desktop-storage/spec.md#p01p08-供应商界面更新)），用户要手工填写协议、Base URL、模型能力、推理档位和 compat。锁定的 pi-ai 内置目录（`builtinModels()`）能提供部分数据，但一个供应商常有多个协议入口，pi-ai 只收录其中一部分。例如 DeepSeek 同时提供 Chat Completions、Anthropic Messages 和 Responses 三种格式，pi-ai 1.0.4 只有 Chat Completions。目录也没有图标与 Rukie 的 `automaticReasoning` 等字段。后续要持续扩充供应商，并能在 pi-ai 之外修正数据。

## 决定

- Provider Preset 是 Rukie 内置的只读接入资料，放在 `@rukie/ui` 的 `lib/provider-presets/`，每个供应商一个 TypeScript 文件，由开发者手工维护，并标明数值来源与核对日期。
  - 预设不在运行时读取 pi-ai 目录。数值可以从 pi-ai 抄入，抄入后独立维护。
  - 用户不能编辑预设。
- 一个预设包含展示名称、图标键、API Key 获取链接和若干协议变体。每个变体由协议、Base URL 和模型列表组成，每个模型带自己的能力、推理档位映射、compat 和价格。变体之间允许模型列表不同。
- 用户选择预设时立即创建并保存一个普通 Model Service。
  - 服务归用户所有，执行、编辑和删除与自定义服务完全一致。
  - 预设更新不改变已创建的服务。
  - 服务不保存预设引用，只在创建时写入展示用的 `icon` 键。
  - 新建服务的表单停留期间，界面在内存中记住来源预设，切换协议时整体替换为对应变体的 Base URL 和模型。离开表单后不再联动。
- 来源预设仍在当前表单内存中时，API Key 标签旁展示获取链接。浏览器以标准外部链接打开；Electron main 只允许受信任 app 窗口和 app 来源打开固定的 `https://platform.deepseek.com/api_keys`，交给系统浏览器并始终拒绝应用内弹窗，其他地址仍拒绝，不新增任意 URL 的 host 或 IPC 能力。
- 图标键是 `@rukie/shared` 中的封闭枚举。`@rukie/ui` 的 `ProviderIcon` 是唯一的图标渲染入口，使用 `@lobehub/icons` 的纯 SVG 组件，不引入它的 antd 与 `@lobehub/ui` peer。
- 删除未被界面使用的 `applicationModelTemplates` 及其 wire、IPC 与 host 通道。预设只有界面一个消费者，不再经 sidecar 提供。
- 桌面存储 spec 中“添加供应商不展示预设”的决定由本记录替代。

## 备选方案

- 直接展示 pi-ai 全量目录：约 40 多项无法筛选，缺少图标、其他协议入口和 Rukie 字段，修正数据只能等上游发布。
- 注册表只引用 pi-ai 的供应商与协议，模型数据运行时读取：上游变化会静默改变预设，且无法表达 pi-ai 未收录的协议入口。
- 服务持续关联预设，模型列表随预设更新：会让已保存服务的模型能力随版本漂移，Model Selection 与 Transcript 的可重建性依赖预设历史。
- 预设放在 `@rukie/shared` 或经 sidecar 提供：当前只有界面使用，多一层通道和包依赖却没有消费者。
- 使用 `@lobehub/icons` 完整入口：需要安装 antd 与 `@lobehub/ui`，引入与 DESIGN.md 冲突的第二套组件和主题体系。

## 影响

- 扩充一个供应商需要四样东西：一个预设文件、一个图标键、一条图标映射、zh 和 en 文案。测试校验每个变体都满足 `ModelServiceSchema` 与对应协议的 compat schema，图标映射由类型检查保证穷尽。
- 代价是预设数值要人工跟进供应商的变化。pi-ai 未覆盖的协议变体只有文档和 payload 测试依据，需要用真实凭据手动验收。
- `@lobehub/icons` 的深路径属于包内部结构，升级版本时要核对导入路径。Bun 通过仓库级 `install.peer = false` 关闭自动安装 peer，锁文件仍记录解析元数据；ui 在保留 React 与 React DOM peer 合同的同时显式声明测试和构建的 devDependencies。此策略影响整个仓库，其他 workspace 也必须显式声明实际需要的运行依赖；精确版本与安装策略见 [技术栈](../tech-stack.md)。
- 实施与验收见 [供应商预设 spec](../../.scratch/provider-presets/spec.md)。
