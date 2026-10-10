Status: ready-for-agent

# Spec: 模型切换面板（Model Selection）

## Problem Statement

`/model` 面板现在把所有模型平铺列出，每行只显示 spec。pi-ai 内置 42 个 provider、1537 个模型，大部分我都没有凭据，常用的几个很难找。名称相同的模型（同一个 "Kimi K3" 有 13 个 provider 提供）看不出区别。Thinking Level 只能在启动时用 `settings.thinking` 或 `--thinking` 指定，Session 运行中改不了。另外，继承模型的子 agent 用的是 `settings.thinking`，不是父 Session 当前的档位；状态栏的档位也取自 settings，不是 Session 实际在用的值。

## Solution

`/model` 面板参考 dsh-TUI 的 ModelPicker：

- 按 provider 分成多个 tab，模型行显示名称和完整 spec。
- 直接打字可以跨 tab 过滤。
- 底部有 Thinking Level 档位条，模型和档位在同一个面板里确认。
- 终端变矮时逐级降低显示内容。

Agent Core 用一个统一入口同时修改模型和 Thinking Level，切换只对当前 Session 生效。Thinking Level 和模型一样随 Rewind 回退、在 resume 时恢复。子 agent 和状态栏都改为读取 Session 当前的 Model Selection。

术语见 [CONTEXT.md](../../CONTEXT.md) 的 Model Selection 与 Thinking Level。

## User Stories

1. 作为用户，我输入 `/model` 后看到按 provider 分组的 tab，打开时停在当前模型所在的 tab，焦点落在当前模型上。
2. 作为用户，面板只列出已检测到凭据的 provider、当前模型所在的 provider 和 settings 里的自定义 provider，底部提示“仅显示已配置凭据的 provider”。
3. 作为用户，自定义 provider 没有凭据时，它的模型置灰并标“未配置凭据”。按 Enter 不会切换，只给出提示。
4. 作为用户，每行显示“名称 + 灰色 spec”，当前模型前标 ✓。名称和 spec 相同时只显示 spec。终端窄时先截断名称，最后才截断 spec。
5. 作为用户，空间够时，每行下面显示能力摘要：是否支持图片输入、是否支持 reasoning、context window。
6. 作为用户，直接打字时，按名称、spec 或 provider 显示名做子串过滤（不区分大小写），结果跨 tab 平铺显示。Esc 先清空输入，输入为空时再按 Esc 才关闭面板。
7. 作为用户，我用 Tab / Shift+Tab 切换 provider，用 ↑/↓ 选模型，用 ←/→ 调 Thinking Level，按 Enter 让模型和档位一起生效，按 Esc 全部放弃。
8. 作为用户，模型不支持 reasoning 时，档位条显示为不可用。
9. 作为用户，新模型不支持当前档位时，档位会降到它支持的下一个较低档，切换提示里会说明。
10. 作为用户，只改档位、不换模型也算一次切换。切换后看到一条合并的提示，例如“已切换模型：Kimi K3（moonshotai/kimi-k3）· thinking high”，没变的部分不写。
11. 作为用户，状态栏在 spec 后面显示非 off 的档位，取 Session 当前值。
12. 作为用户，`/model <spec>` 只切换模型，档位按规则降级。
13. 作为用户，Run 进行中输入 `/model` 时会看到不能切换的提示，切换不会排到 Run 结束后执行。
14. 作为用户，Rewind 后模型和档位回到当时的选择，resume 后恢复为离开时的选择，settings.json 不会被改写。
15. 作为用户，继承模型的子 agent 使用父 Session 当时的模型和档位。显式指定模型的子 agent 使用 settings 默认档位，再按它的模型降级。
16. 作为用户，在小终端里面板逐级降低显示内容，也可以用鼠标点击 tab、模型行和档位格。

## Implementation Decisions

### Agent Core

- 用 `setModelSelection({ model?, thinkingLevel? })` 替换 `setModel(spec)`，只保留这一条执行路径。
  - 它沿用空闲检查（`assertAvailable`）和 `selectingModel` 并发保护，在凭据检查失败时报 `no-api-key`。
  - 它先算出最终档位，再一次性调用 `conversation.configure({ model, thinkingLevel })`，并写入 Tool State。
  - 返回值是实际生效的 `{ model, thinkingLevel, clampedFrom? }`，frontend 根据它生成提示。
- Session 新增 `thinkingLevel` 只读属性，和 `model` 并列。
- 档位降级规则：
  - 在 `getSupportedThinkingLevels(model)` 中取不高于所选档位的最高档。
  - 没有这样的档时，取它支持的最低档。
  - `reasoning: false` 的模型只支持 `off`。
  - 请求时不再依赖 pi 先往高档找的 `clampThinkingLevel`，因为保存的档位已经是该模型支持的档。
- `modelState` 升到 version 2，值改为 `{ model, thinkingLevel }`，`parse` 兼容 v1 的字符串。实现时要确认 Rewind 会把恢复后的 Tool State 重新应用到原生 configure 上，否则改为直接依赖 AgentDoc 的 rewind 语义，只保留一个状态来源。
- resume 时，模型和档位都取保存的 Model Selection。
- 子 agent：
  - 非 fork、非 retained、继承模型的子 agent，取父 Session 当前的 `thinkingLevel`。
  - 显式指定模型的子 agent，用 `settings.thinking` 按它的模型降级。
  - fork 和 retained 的子 agent 保持现有行为。
- 模型目录：`listModels` 改名为 `listModelCatalog(settings)`，改成异步。每项包含：
  - `spec`、`id`、`name`、`providerId`、`providerName`、`input`、`reasoning`、`thinkingLevels`、`contextWindow`、`custom`、`authenticated`。
  - 凭据检查使用 `getAuthenticatedProviders()`，不发网络请求。Agent Core 只提供这些事实，列表要过滤掉哪些 provider 由 frontend 决定。

### TUI

- `view/`（不依赖终端）负责以下逻辑：
  - 可见 provider 的过滤（Q10）；
  - tab 排序：自定义 provider 在前，内置 provider 按显示名排序；
  - 子串过滤；
  - 行文本的组装与截断顺序；
  - 合并提示文案的生成。
- `ModelPicker` 改为由以下部分组成：标题、提示行、provider tabs 或过滤输入、模型列表（带滚动标记）、档位条、底部说明。
  - 光标状态保存在 ref 里同步更新，连续按键总是作用于最新的焦点。
  - 每个 tab 单独记住自己的焦点。
- 打开面板时，先等目录加载完再显示，加载期间显示“加载中”。加载失败时显示错误提示，并保留 `/model <spec>` 可用。
- 小终端降级顺序：
  1. 去掉分区空行和档位说明；
  2. 提示行缩短为 `Enter · Esc`；
  3. 隐藏能力摘要；
  4. 高度不足 3 行时隐藏档位条。
     降级过程中保持 ADR-0006 的阅读位置和 bottom-follow 行为。
- 状态栏的档位改为来自 `session.thinkingLevel`。
- zh 和 en 文案同步更新（ADR-0008）。

### Out of Scope

- 不做 Recent Models、`/thinking` 命令、`/model <spec> <level>`、快捷键，也不做点击状态栏打开面板。
- 不把选择写成全局默认值，不显示价格。
- Headless CLI 不增加 Session 运行中的切换方式，`--model` 和 `--thinking` 保持现状。

## Testing Decisions

- Agent Core 的 e2e 测试用 `createSession` 加 fake model，通过 faux 模型的 `reasoning` 和 `thinkingLevelMap` 区分档位。覆盖以下场景：
  - 只改模型、只改档位、两者同时改；
  - 降档，以及没有更低档时取最低档；
  - 凭据缺失、Run 中拒绝、并发切换；
  - 请求中实际携带的 thinking 参数；
  - Rewind 后恢复为当时的选择；
  - resume 后恢复，且不受 settings 和 `--thinking` 影响；
  - v1 modelState 迁移；
  - 子 agent 两种继承路径。
- 模型目录测试使用隔离的 env 和 settings，断言 `authenticated` 和 `custom` 的取值，不依赖真实凭据。
- TUI 用 `start` 和 headless terminal 做终端断言，覆盖以下场景：
  - tab 切换和每个 tab 记住的焦点；
  - 过滤，以及 Esc 先清空再关闭；
  - 档位草稿和 Enter 生效；
  - 置灰模型按 Enter 时给出提示；
  - 重名模型能区分；
  - 80×24、60×16、40×12 三种尺寸下的降级；
  - 鼠标点击；
  - Run 中输入 `/model`；
  - 状态栏档位。
    现有的 `model-switch.test.ts` 和 `image-model-notice.test.ts` 按新接口更新。

## ADR Coverage

| 决定或修改                                                            | 归属                                                               | 理由                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Model Selection 原地切换，由原生 Agent document 保存，不 fork Session | 沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)   | 模型和档位继续由原生 AgentDoc 持有，v2 Tool State 在同一事务写入镜像；Rewind/resume 从 AgentDoc 恢复，Transcript 不分叉 |
| 面板文案只在 frontend                                                 | 沿用 [ADR-0008](../../docs/adr/0008-locale-agnostic-agent-core.md) | Agent Core 只返回事实（目录、实际生效的选择），文案由 TUI 生成                                                          |
| 小终端降级与阅读位置                                                  | 沿用 [ADR-0006](../../docs/adr/0006-fullscreen-tui.md)             | 面板高度预算不破坏 bottom-follow 和小终端处理                                                                           |
| 只对 Session 生效、只往低档降、去掉 Recent Models                     | 无需 ADR                                                           | 均可低成本撤回，不涉及模块所有权或持久化格式的长期取舍；术语已记录在 CONTEXT.md                                         |

## Code review evidence

Review fixes count ModelPicker chrome within its allocation, add actual terminal-height and 40×12 persistent-panel coverage, and update four thinking fixtures to reasoning-capable per-case metadata. Detailed red/green, synchronization correction, timings and ADR assessment are recorded in ticket 07. Integration acceptance and closure remain with the integration owner.
