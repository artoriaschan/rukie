Status: ready-for-agent

# Spec: 按最新 DESIGN.md 重构桌面与 Web 前端

来源：[DESIGN.md](../../DESIGN.md)。本 spec 基于以下两次提交后的版本：faae3352 重写了 GUI 设计规范，70b779c2 补充了 Run and Trace presentation。规范本身的验证记录见 [design-system-spec](../design-system-spec/verification.md)，它是纯文档变更，没有迁移任何实现。术语见 [CONTEXT.md](../../CONTEXT.md) 中的 Run、Turn、Transcript、Run Outcome 和 Interaction。

## Problem Statement

DESIGN.md 已整体重写，但 `packages/ui` 仍按旧规范实现。规范第 7 行明确说明它不代表现有实现已符合。盘点（基线 `cc17c80b`）发现以下差异：

- **语义色**：`theme.css` 仍是旧色板。例如 Light `foreground` 是 `#262626`，目标 `#171717`；Light `border` 是 `#0d0d0d1a`，目标 `#ebebeb`；Light `secondary` 是 `#e6e6e6`，目标 `#ffffff`；Light `primary` 是 `#000000`，目标 `#171717`。Dark `background` 是 `#000000`，目标 `#212121`；Dark `card` 是 `#2b2b2b`，目标 `#212121`；Dark `foreground` 是 `#d4d4d4`，目标 `#fafafa`。
- **重复与违规定义**：Dark token 写了两份（`.dark` 和 `prefers-color-scheme` 媒体块）。还留着一个 rem 写法的 `--radius: 0.75rem`，以及规范禁止的 `.glass*` 模糊工具类。
- **设置页平行色板**：`model-services.css` 用写死的 hex 覆盖 `--background`、`--card`、`--border` 等核心 token。
- **共享原语几何未到目标**：
  - Button 的 `md` 和 `lg` 只用 8px 圆角，且统一使用 base 字号。
  - Input 和 Select 是 32px 高、8px 圆角。
  - 菜单壳是 8px 圆角。
  - Dialog 内边距是 16px。
  - 页面 CSS 直接改写原语的内部元素，例如 `.project-dialog > div` 和 `.app-titlebar-navigation button`。
- **主题切换缺失**：只跟随系统，没有 System / Light / Dark 选择。设置导航里已经有"外观"入口，但标为不可用。
- **Run/Trace 呈现与契约不符**：
  - `transcript.tsx` 在失败、中止或运行时用 effect 强制展开外层过程，覆盖了读者的选择。
  - PromptGroup、活动段和工具行的展开状态都是虚拟行内部的 `useState`，行被回收后重新挂载就会丢失。
  - 工具在挂载后才失败时，不会按默认展开。
- **组件与写法杂乱**：
  - 有未被引用的组件：`StatefulButton`、`MetallicButton`、`MagneticButton`、`drawer`、`center-morph-modal`。
  - 推理文本使用 `text-scramble` 装饰动画。
  - 约 8 处产品层使用原生 `<button>`，没有用 Button 原语。
  - 各功能 CSS 里有写死的 hex、`font-size` 和 z-index，以及任意值 `rounded-[20px]` 和 `rounded-[1px]`。

## Solution

以最新 DESIGN.md 为唯一目标重构 `packages/ui`，并做必要的 desktop 宿主适配。现有实现中不符合规范的取值一律不保留。规范自己点名的 Rukie 尺寸本身就是规范内容，按规范执行，包括壳层、Transcript、composer、模型选择器、搜索面板、Project 对话框、新聊天选择条、worktree、Goal、Plan 和设置页的局部几何。

规范里没给出数值的地方，先在 DESIGN.md 里补上，再实现，不在代码里写一次性值。工作分 8 张 ticket，一张 ticket 对应一个分支和一个 PR，按依赖顺序交付。

## Decisions

本节记录会话中用户确认的决定（2026-10-16）。

1. 范围只包括 `packages/ui` 和必要的 `packages/desktop` 宿主适配。TUI、`ink/` 和 Headless CLI 不在范围内。
2. 用户的原话是"完全按照最新版的 DESIGN 去重构，之前的都作废"。这构成 DESIGN.md [Layout preservation](../../DESIGN.md#layout-preservation) 所要求的明确布局授权。规范中"迁移前保留"的通用旧值全部迁移到新目标，涉及基础控件 8px/6px 圆角、32px 字段、菜单壳与菜单行、Session 菜单、Dialog 内边距等。
3. Button 不重新定义 `sm` / `md` / `lg` 这三个尺寸名的含义，而是增加语义变体，每个调用点显式选择。见规范第 196 行。
4. 规范空白处先修订 DESIGN.md（ticket 01），实现 ticket 只引用规范里的值。
5. 新增 System / Light / Dark 外观设置，偏好只保存在前端本地，不进 Agent Core 或 user settings。
6. 布局回归的规则：每张 ticket 在实施前写一份"授权差异表"，列出区域、属性、旧值和新值。测试里只修改表上列出的断言，其余断言保持 ±1px 容差；表外出现的差异一律当作缺陷修复。
7. 交付形态：本 spec 加 8 张 ticket，每张 ticket 一个分支和一个 PR。

## User Stories

1. 作为桌面或 Web 用户，我希望 Light 和 Dark 都使用规范的中性画布、阅读文字和安静边框，长时间阅读时层级清晰、对比度达标。
2. 作为用户，我希望在设置的"外观"里选择 System、Light 或 Dark。选择在刷新和重启后保留；选 System 时，界面跟随系统即时切换。
3. 作为用户，我希望按钮、输入框、选择器、菜单、弹层和对话框在各页面使用同一套尺寸、圆角、阴影和状态反馈，不出现页面各自的变体。
4. 作为键盘用户，我希望所有操作都有可见的 2px 焦点、正确的光标和可访问名称；禁用状态同时阻止指针和键盘激活。
5. 作为阅读执行过程的用户，我手动展开或收起 Run 过程、活动段或工具详情后，希望这个选择在流式更新、工具完成、Run 结束和虚拟行回收后都保持不变。
6. 作为用户，我希望失败的工具默认展开详情，失败或中止的过程默认展开，但不会覆盖我已经做出的选择。
7. 作为用户，在 420px 窗口、18px 界面字号、zh/en 和减少动态效果的设置下，我希望主要操作仍然可用，页面没有横向溢出。

## Implementation Decisions

### 规范补齐（ticket 01）

- 补齐 DESIGN.md 未定义的数值：28px 上下文按钮、24px 微操作、标准与紧凑菜单行、Session 紧凑菜单行和 Tooltip 的圆角。嵌套表面按规范第 217 行"降一级"推导，例如 12px 菜单壳内的行用 8px。
- 补齐 Dark 下的覆盖层阴影和 composer 阴影的配方。规范第 219 行要求在共享 owner 定义并验证。
- 补齐设置页表面角色的取值，优先映射到参考色板的 Canvas、Soft canvas、Muted surface，不另起色板。
- 逐个指明各表面绑定共享 token 还是 `layout-*` 结构 token。Dark `background` 改为 `#212121` 后，Plan Pane、摘要卡、消息气泡、composer 和 Transcript 都需要明确归属。
- 改写规范里"受保护，直到显式迁移"的过渡性表述，与 Decisions 第 2 条一致，避免实现完成后规范自相矛盾。
- CONTEXT.md 新增两个呈现层术语 Trace 和 Activity Segment，并注明 Avoid: Run, step。`packages/ui/README.md` 里把 PromptGroup 的展开称作"展开 Run"，改为"展开执行过程"。

### 主题 token（ticket 02、03）

- `theme.css` 仍是唯一的 token owner。按规范的 Shared token 表迁移 `:root` 和 `.dark`。`layout-*` 结构 token 保持规范值不变。
- Dark 取值只保留一份来源，System 偏好与 `.dark` 解析到同一组语义角色。删除 `--radius` rem 写法、`.glass*` 工具类及其 token。
- 新增具名的覆盖层阴影和 composer 阴影角色，Light/Dark 各一组，取值来自 ticket 01。
- `text-ui-caption` 的行高改为 18px。去掉原语里的 `leading-[1.5]` 覆盖，改由类型角色提供行高。
- 每对受影响的文字与表面组合，在两种主题下实测对比度并记录结果。
- 设置页删除对核心 token 的局部覆盖，改用 `theme.css` 中具名的 `settings-*` 角色。字面 `font-size` 改为 `text-ui-*`。规范点名的设置页几何保持不变：880/224/656px、32px 字段、8px 圆角、模型对话框 672/704/82/60px、68px 卡片。

### 共享原语（ticket 04、05）

- Button 增加语义变体：
  - `standard`：36px，16px 水平内边距，14/20 字号，12px 圆角。
  - `compact`：32px，12px 水平内边距，12/16 字号，12px 圆角。
  - `contextual`：28px。
  - `micro`：24px。
  - `icon`：24px 方形，6px 圆角。

  每个调用点显式选择一种变体。

- Input 和 Select trigger 改为 36px、12px 圆角；Textarea 声明增长上限和滚动 owner。Switch、Checkbox、Radio 按规范尺寸实现。
- 菜单：dropdown、context 和 Select 面板的壳为 4px 内边距、12px 圆角，行高 32px；Session 菜单使用显式的 26px 紧凑变体。Popover 用 12px 圆角，Dialog 用 16px 圆角、24px 内边距，窄窗口时水平内边距 16px；标题和底栏固定可见，正文滚动。小型重命名 Dialog 最大宽 384px。
- 页面不再改写原语的私有元素，所需差异改为原语提供的变体。
- 删除未引用的 `StatefulButton`、`MetallicButton`、`MagneticButton`、`drawer`、`center-morph-modal`，以及它们在 `components/index.ts` 中的导出。推理文本的 `text-scramble` 改为静态文本。产品层的原生 `<button>` 改用 Button；保留原生按钮的注册库原语在 ticket 中逐个说明原因。

### 外观设置（ticket 06）

- 把设置导航中现有的"外观"入口改为可用，内容只有一个三选一控件：System、Light、Dark。
- 偏好存在 renderer 的 `localStorage` 中，在首次绘制前应用，避免闪烁。选 System 时监听 `prefers-color-scheme` 的变化。
- 检查 Electron 窗口的原生外观是否需要经 host 同步，例如 `nativeTheme.themeSource`。如需同步，在 preload 暴露最小 API。真实 Electron 验收遵守[原生验收授权边界](../../docs/testing.md#原生验收授权边界)。

### Run/Trace（ticket 07）

- 读者的展开选择保存在当前 keyed Session 视图的呈现状态中，不放在虚拟行内部的组件 state 里。键使用呈现身份：PromptGroup、活动段和工具调用的投影 id。这份状态不持久化，也不进 Core。
- 默认值由生命周期决定：进行中为展开，正常结束为收起，失败或中止为展开，历史记录按其结局推导。只要读者尚未做出选择，就应用默认值；读者做出选择后，任何流式更新、错误或结束都不能改变它。
- 先对照规范的 Required presentation scenarios 逐项做符合性审计，每个不符合项先写失败的公开行为测试，再修复。

### 功能页面（ticket 08）

- 逐节核对 DESIGN.md 中的功能尺寸：壳层、对话、模型选择器、搜索、Project、新聊天选择条、worktree、Goal、Plan、Preview Rail 和滚动条。
- 功能 CSS 里的 hex 改为 token，z-index 改为层级 token，任意 `rounded-[…]` 改为具名角色。
- `check:ui-typography` 扩展到 CSS 中的 `font-size` 字面值，防止迁移完成后回退。

## Testing Decisions

- 遵守 [testing.md](../../docs/testing.md)，按 ADR-0004 使用 Vitest Chromium browser mode。几何断言使用实测的 bounding box 和计算样式，CSS class 断言和截图不算几何证据。
- 布局套件：[layout](../../packages/ui/tests/app/layout.browser.test.tsx)、[shell](../../packages/ui/tests/app/shell.browser.test.tsx)、[transcript](../../packages/ui/tests/app/transcript.browser.test.tsx)、[conversation dock](../../packages/ui/tests/components/conversation-dock.browser.test.tsx)、[composer](../../packages/ui/tests/components/compact-composer.browser.test.tsx)，以及 `compact-*`、`f01-controls`、`semantic-roles`、`press-feedback`、`instant-interactions` 和各功能套件。
- 每张 ticket 的授权差异表放在 ticket 正文。只修改表内列出的断言，并保留原失败事实。
- 覆盖维度：Light/Dark、1280 与 420 宽度、14px 与 18px 界面字号、zh/en、减少动态效果、hover、按下、焦点、禁用以及光标。
- 每张 ticket 在 focused 测试和静态检查通过后，用 agent-browser 做一次 `dev:desktop:web --isolated` 验收：截取 Light、Dark 和窄宽度截图，检查控制台和网络。
- ticket 02、04 和 07 会影响所有屏幕，各运行一次 `bun run test:desktop`。其余 ticket 只跑受影响的文件，并按[增量复验规则](../../docs/testing.md#验证记录与增量复验)复用已有证据。

## Out of Scope

- TUI、`ink/` 渲染器、Headless CLI 和 Agent Core 行为。
- 规范第 451 行排除的设置页详细内容：provider 和模型配置逻辑不重新设计。
- 新的首页问候设计和品牌插画。规范第 130 行的 Home display 只是可选角色，不构成首页重设计的授权。
- 原生 macOS 材质和 vibrancy 的验收。
- `.scratch/new-chat-selector` 仍标为 claimed，但实现已合入 main。它属于另一项 feature，不在本 spec 中修改。

## ADR Coverage

| 决定或修改                                  | 归属                                                              | 理由                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ui 分层与依赖向下                           | 沿用 [ADR-0029](../../docs/adr/0029-desktop-package-structure.md) | 只调整 components 与 app 内部的呈现，不改包结构或依赖方向                                   |
| Run/Trace 读者选择存于 Session 视图呈现状态 | 无需 ADR                                                          | 只是在 ui 内部移动状态位置，不持久化，不进 Core 或 wire；DESIGN.md 已规定其可见行为         |
| token、原语几何与组件来源                   | 无需 ADR                                                          | DESIGN.md 和 AGENTS.md 已规定组件来源顺序和视觉规则，本工作只是实现它们，不引入新的长期取舍 |
| 外观偏好存于 renderer localStorage          | 无需 ADR                                                          | 偏好只影响前端呈现，不进 settings schema、Core 或 wire，以后改变存储位置的成本很低          |

## Comments
