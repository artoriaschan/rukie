Status: ready-for-agent

# Spec: 模型服务供应商预设与设置页表单调整

## Problem Statement

桌面端添加供应商只有"创建自定义供应商"一个入口，用户要自己查协议、Base URL、模型 ID、上下文、推理档位和 compat。接入 DeepSeek 这类常用供应商门槛高，也容易填错。供应商表单需要手动点"保存"，并且会逐项校验、报错，和用户期望的"填了就生效"不一致。设置区表单的标签间距、输入框高度和圆角不统一：供应商表单是 1px、30px、8px，模型弹窗是 6px、36px、12px。

## Solution

- 新增 Rukie 手工维护的 Provider Preset（[ADR-0038](../../docs/adr/0038-hand-maintained-provider-presets.md)）。本次只提供 DeepSeek 预设。
  - 用户在添加供应商目录（rukie.pen P02 / L-P02）点击 DeepSeek，立即生成一个已预填的 Model Service，填入 API Key 即可使用。
  - 预设带 Anthropic Messages、Chat Completions、Responses 三个协议变体。
- 供应商图标改用 `@lobehub/icons`，由创建时写入服务的 `icon` 键决定。
- 供应商表单改为自动保存：
  - 删除保存和取消按钮。
  - 删除 Base URL、API Key 与模型的校验及校验提示。
  - 服务新增整体启用开关，新建时默认开启。
- 设置区表单统一为：标签到控件 4px，单行输入框和 Select 高 32px，输入框、Select、Checkbox 与 Radio 选项外框圆角 8px。

## User Stories

1. 作为用户，我在添加供应商目录点击 DeepSeek，立即得到一个名称、协议、Base URL 和模型都已填好的服务，只需填 API Key。
2. 作为用户，我在新建 DeepSeek 服务的表单里切换 API 格式，Base URL 与模型列表随之换成该协议的配置。
3. 作为用户，我可以添加多个 DeepSeek 服务，例如两个账号，它们分别命名为 DeepSeek 和 DeepSeek 2。
4. 作为用户，我修改供应商表单的任何字段都会自动保存，不需要点保存，也不会因为格式不对被拦住。
5. 作为用户，我可以用开关整体停用一个服务。停用后它的模型不出现在模型选择器中，重新开启后各模型的启用状态保持原样。
6. 作为用户，我在供应商列表、详情头部和模型选择器中看到 DeepSeek 的品牌图标，自定义服务显示通用图标。
7. 作为开发者，我新增一个供应商预设只需要一个预设文件、一个图标键、一条图标映射和 zh/en 文案，漏掉其中一项时测试或类型检查会失败。

## Implementation Decisions

### 术语

[CONTEXT.md](../../CONTEXT.md) 新增 Model Service 与 Provider Preset。代码使用 `ProviderPreset`，现有 `ModelService` 命名不变，不再使用 template 和 catalog 指代预设。

### Model Service 数据

`packages/shared/src/model-services.ts` 的 `ModelServiceSchema` 新增两个可选字段：

- `enabled?: boolean`：缺省视为开启。旧数据不迁移。停用的服务在 `createApplicationModels` 中整体跳过，模型自身的 `enabled` 不变。
- `icon?: ProviderIconKey`：取值来自 `@rukie/shared` 新增的 `PROVIDER_ICONS` 封闭枚举，本次只有 `deepseek`。缺省显示通用图标。由预设创建时写入，本次不提供修改入口。

`WireModelCatalogEntry` 新增可选的 `providerIcon`，桌面模型目录从服务的 `icon` 填入。终端目录不填。

### 校验

- 客户端删除 `persist` 中的 URL、名称、模型 ID 唯一性与 compat 前置校验，以及对应的 `services.invalid` 和 `services.apiIncompatible` 提示。
- server（`app-database.ts`）删除"有模型必须有 URL"和 URL 协议、凭据、查询串、片段校验，接受任意 Base URL 字符串，包括空字符串和含 userinfo 的 URL。
- 模型的 compat、默认推理档位等结构校验保留在 server。它们保护的是执行时的协议合同，不是用户输入格式。界面上，预设和模型弹窗只会生成合法的值。
- 运行时遇到无法解析的 Base URL 时，该服务的模型不进入模型目录，静默跳过，不影响其他服务。
- 已知限制：含用户名和密码的 Base URL 会以明文保存在服务配置中，不经过凭证加密。这是用户明确选择不做输入校验的结果。

### 供应商预设

- 位置：`packages/ui/src/lib/provider-presets/`。每个供应商一个文件，例如 `deepseek.ts`，由 `index.ts` 导出有序列表。模块 JSDoc 写明新增供应商的四个步骤。
- 结构：`ProviderPreset` 包含 `id`、`name`、`icon: ProviderIconKey`、`apiKeyUrl`、`defaultApi` 和 `variants`。
  - `variants` 以协议为键，每个变体包含 `baseUrl` 和 `models`。
  - 模型类型复用 `ModelService["models"][number]`，保证与服务字段一致。
- 数据来源：每个变体注明来源和核对日期。来源为 [DeepSeek 定价页](https://api-docs.deepseek.com/quick_start/pricing)、Anthropic 与 Responses 兼容文档、pi-ai 1.0.4 `providers/data/deepseek.json`，核对日期为 2026-10-12。

DeepSeek 预设：

| 变体（下拉按首字母排序）   | Base URL                             | 模型          | compat                                                                                                                                                                                                                                                                                     | off  |
| -------------------------- | ------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Anthropic Messages（默认） | `https://api.deepseek.com/anthropic` | flash、v4-pro | `forceAdaptiveThinking: true`、`supportsLongCacheRetention: false`                                                                                                                                                                                                                         | null |
| Chat Completions           | `https://api.deepseek.com`           | flash、v4-pro | `supportsStore: false`、`supportsDeveloperRole: false`、`supportsReasoningEffort: true`、`maxTokensField: "max_tokens"`、`requiresReasoningContentOnAssistantMessages: true`、`thinkingFormat: "deepseek"`、`supportsStrictMode: true`；v4-pro 另加 `supportsMidConvoSystemMessages: true` | 保留 |
| Responses                  | `https://api.deepseek.com`           | 仅 flash      | `supportsDeveloperRole: false`、`supportsLongCacheRetention: false`、`sessionAffinityFormat: "openai-nosession"`                                                                                                                                                                           | null |

| 模型              | 名称                | 输入        | 上下文 / 最大输出   | thinkingLevelMap                             | 价格（USD / 百万 token，高峰）               |
| ----------------- | ------------------- | ----------- | ------------------- | -------------------------------------------- | -------------------------------------------- |
| `deepseek-flash`  | DeepSeek V4.1 Flash | text, image | 1,000,000 / 384,000 | minimal、medium 为 null；low、high、max 原样 | 输入 0.3、输出 1.2、缓存读 0.006、缓存写 0   |
| `deepseek-v4-pro` | DeepSeek V4 Pro     | text        | 1,000,000 / 384,000 | minimal、low、medium 为 null；high、max 原样 | 输入 1.32、输出 3.96、缓存读 0.044、缓存写 0 |

- 两个模型都设 `reasoning: true`、`automaticReasoning: true`、`defaultThinkingLevel: "automatic"`，`priceSource` 填定价页 URL。
- 表中 off 列为 null 时，在该变体的 `thinkingLevelMap` 里设 `off: null`。原因是 DeepSeek 文档没有说明 Anthropic 端点接受 `thinking: {type: "disabled"}`，也没有说明 Responses 端点接受 `reasoning.effort: "none"`。
- 价格按高峰价填写，因为低估成本比高估更有害。

### 界面流程

- **添加供应商目录**按 P02 / L-P02 排列，依次为"创建自定义供应商"卡片和各预设卡片。卡片使用 `ProviderIcon`。
- **点击预设卡片**立即创建并保存服务：
  - id 用预设 id（`deepseek`），重复时依次为 `deepseek-2`、`deepseek-3`；名称为"DeepSeek"，重复时依次为"DeepSeek 2"、"DeepSeek 3"。
  - 字段取 `defaultApi` 变体，`icon` 取预设图标，`enabled: true`。
  - 创建后选中该服务并显示详情。
- **点击"创建自定义供应商"**也立即保存：id 为 `provider-<uuid>`，名称为"新供应商"，协议为 Anthropic Messages，Base URL 为空，没有模型，`enabled: true`，没有 `icon`。
- **协议联动**：服务从预设创建后，只要它仍是当前表单（没有切换到其他服务，也没有离开设置页），切换 API 格式就整体替换为该变体的 Base URL 与模型列表并立即保存。来源预设只保存在界面内存中，切走或卸载后清除，之后切换协议只改协议字段。
- **自动保存**：
  - Base URL 与 API Key 停止输入 500ms 后保存。切换服务、离开设置页或卸载组件时，立即保存尚未保存的输入。
  - 开关、API 格式、模型增删、启停和编辑在操作后立即保存。
  - 重命名弹窗与模型弹窗保留各自的确认按钮。
  - 删除表单底部的保存和取消按钮，以及"已保存"状态提示。
  - 读取、保存、显示 Key、测试模型的失败提示保留。
  - 保存失败时，输入内容保留在表单中。
- **服务开关**读写 `enabled`，不再由模型推算，没有模型时也可以操作。
- **图标展示**：供应商列表、详情头部和模型选择器统一用 `ProviderIcon`，入参是 `icon` 键。删除按名称或 id 别名推断图标的逻辑和手写的三个品牌 SVG，旧服务显示通用图标。

### 图标依赖

- `@lobehub/icons` 精确锁定 `5.23.0`，只深导入 `es/<Brand>/components/Mono` 和 `Color`，不安装 `antd` 与 `@lobehub/ui`。
- `packages/ui/src/components/provider-icon.tsx` 是唯一导入点，通过 `Record<ProviderIconKey, …>` 穷尽映射。
- 预设卡片与列表使用 Color 变体，因为 P02 中 DeepSeek 用 `#5368ff` 彩色。
- 需要的话，补充 TypeScript 模块声明并记录原因。
- 更新 `docs/tech-stack.md` 与 lockfile。

### 设置区样式

范围是 C03 设置导航和模型服务页，包括 C10–C17 与 C26。rukie.pen 已于 2026-10-12 更新并经用户确认。

- 表单项标签到控件的垂直间距统一为 4px：
  - C11 从 1px 改为 4px。
  - C16 从 6px 改为 4px。
- 单行输入框与 Select 触发器统一为 32px 高：C11 从 30px 改为 32px，C16 从 36px 改为 32px。
- 输入框、Select 触发器、Checkbox 与 Radio 选项外框圆角统一为 8px：
  - C16 从 12px 改为 8px，选项外框高度仍为 28px。
  - 选项内 16px 的勾选标记，以及弹窗底部按钮的 12px 圆角不变。
- C11 中"模型列表"及以下内容整体下移 15px，模型列表起点从详情顶部 276px 改为 291px，面板外框尺寸不变。删除 C11 底部的保存和取消按钮。
- [DESIGN.md](../../DESIGN.md#model-services-settings) 同步更新：
  - 上述数值。
  - 删除"provider creation has one custom entry and no preset suppliers"。
  - 删除"Brand paths are copied from Pencil"。
- 这次是用户授权的布局变化，按 [DESIGN.md 布局保护规则](../../DESIGN.md#layout-preservation)执行：改动前先测量基线，改动后运行设置区布局回归。

### 删除 templates 链路

删除以下代码及相关测试：

- `applicationModelTemplates`，以及 `packages/agent/src/index.ts` 中的导出。
- server 的 `templates` 操作与 wire 命令 `modelServices.templates`。
- desktop IPC 的 `rukie:modelServices:templates`，以及 preload 中的暴露。
- host 的 `templates()` 方法。
- 文案 `services.catalog`。

同步更新 [ADR-0037](../../docs/adr/0037-browser-host-sidecar-capabilities.md#模型服务通道) 中的命令列表。

### 不在范围内

- TUI。终端通过 pi-ai 内置注册表和 `DEEPSEEK_API_KEY` 使用 DeepSeek。
- 修改服务图标的入口。
- 其他供应商预设。

## Testing Decisions

- **shared / server**：
  - 校验 `enabled` 与 `icon` 两个字段。
  - 校验 server 接受空 URL、非法 URL 和含 userinfo 的 URL。
  - compat 结构校验仍然生效。
- **agent**：
  - 停用的服务不进入模型目录。
  - Base URL 非法的服务被跳过，其他服务正常。
  - `providerIcon` 进入目录条目。
- **预设**：
  - 每个预设的每个变体都通过 `ModelServiceSchema` 和对应协议的 `ModelCompatSchemas`。
  - `defaultApi` 存在于 `variants`。
  - 模型 id 在变体内唯一。
  - 每个 `icon` 都属于 `PROVIDER_ICONS`。
- **Payload**：通过 fake fetch 截取 `createApplicationModels` 在三个变体、`automatic` 与 `high` 两个档位下发出的请求体，断言：
  - Anthropic 带 `output_config.effort`。
  - Chat Completions 带 `thinking` 与 `reasoning_effort`。
  - Responses 带 `reasoning.effort`。
  - `automatic` 档位下不带任何推理字段。
- **ui Chromium**，使用现有 `model-services.browser.test.tsx` 的脚本化 host：
  - 预设卡片创建服务及其 id 和名称递增。
  - 协议联动，以及切走后不再联动。
  - 自动保存的防抖，并用虚拟时钟验证 500ms 边界。
  - 切换服务和卸载时立即保存。
  - 没有保存按钮，也没有校验提示。
  - 开关在没有模型时可操作，并保留模型启用状态。
  - 保存失败时保留输入并显示提示。
  - 图标展示。
- **布局回归**：在设置区布局用例中断言以下各项，覆盖宽屏与窄屏、Light 与 Dark：
  - 标签到控件的间距为 4px。
  - 输入框与 Select 高 32px。
  - 圆角为 8px。
  - 模型列表起点为 291px。
- **GUI 浏览器验收**：`bun run dev:desktop:web --isolated`。
- **需要用户用自己 Key 手动验收的项目**：
  - 覆盖三个变体，每个变体做一次工具调用、两轮对话，分别使用 `automatic` 与 `high` 档位。
  - 重点检查 Anthropic 变体的 adaptive thinking，以及 Responses 多轮推理是否连贯。
  - 代理不使用真实凭据，这些项目不计入自动化验收。

## Implementation Tickets

| Ticket                                    | 内容                                                                 | Blocked by     |
| ----------------------------------------- | -------------------------------------------------------------------- | -------------- |
| [01](issues/01-model-service-fields.md)   | Model Service `enabled`/`icon`、放宽校验、运行时跳过、删除 templates | —              |
| [02](issues/02-provider-icon.md)          | `@lobehub/icons` 与 `ProviderIcon`、三处图标展示                     | 01             |
| [03](issues/03-deepseek-preset.md)        | 预设模块、DeepSeek 三变体数据、schema 与 payload 测试                | 01             |
| [04](issues/04-settings-form-geometry.md) | 设置区标签间距、输入高度、圆角与 DESIGN.md                           | —              |
| [05](issues/05-autosave-and-catalog.md)   | 自动保存、删除校验、服务开关、预设目录与协议联动                     | 01, 02, 03, 04 |
| [06](issues/06-acceptance.md)             | 集成验收、文档同步与手动验收清单                                     | 05             |

## ADR Coverage

| 决定或修改                                     | 归属                                                                                   | 理由                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 预设手工维护、与服务无执行关联、删除 templates | 新增 [ADR-0038](../../docs/adr/0038-hand-maintained-provider-presets.md)               | 难以撤销的数据来源与所有权取舍，替代桌面存储 spec 的"不展示预设"                          |
| 模型服务 wire 命令列表去掉 templates           | 更新 [ADR-0037](../../docs/adr/0037-browser-host-sidecar-capabilities.md#模型服务通道) | 只修改事实，通道与鉴权决定不变                                                            |
| server 放宽 Base URL 校验                      | 沿用 [ADR-0035](../../docs/adr/0035-desktop-isolated-sqlite-storage.md)                | 凭证仍只经加密 vault 保存；URL 中的 userinfo 是用户自填配置，作为已知限制记录在本 spec 中 |
| 服务整体启用开关                               | 无需 ADR                                                                               | 模型目录过滤的局部扩展，不改变存储、凭证或 Session 合同                                   |
| 设置区样式与自动保存                           | 无需 ADR                                                                               | 局部呈现与交互调整，几何由 DESIGN.md 和 rukie.pen 管理                                    |

## Comments
