# Pencil 会话界面同步

Status: resolved

## 已确认范围

用户确认按桌面 rukie.pen 的深浅色稿同步已有会话功能，优先 C04 模型触发器、C06 模型列表、C07 模型详情与推理。真实配置决定模型、供应商、输入能力、上下文和支持的推理档位；示例模型不写入产品。宽屏列表与详情并排，窄屏上下排列。会话其余已有功能对照 C04/C05/C08/H08，同步视觉差异，缺失功能不增加占位入口。

## Implementation Decisions

- 复用已安装 beUI PromptInput/Button、shadcn DropdownMenu/ScrollArea；保留现有模型默认推理和显式选择语义。
- C06 为 332px、32px 行、2px 间距、4px 内边距；C07 为 280px 独立表面，仅输入、上下文与真实推理档位。
- Pencil 的品牌路径来自组件本身，按明确供应商身份匹配；未知自定义供应商使用通用图标，不根据模型名称猜测品牌。
- 模型局部 Pencil 主题不改变应用外壳、Transcript、审批卡布局；窄屏与字号放大允许内容增长。

## ADR Coverage

| 决定或修改                           | 归属                                                              | 理由                                      |
| ------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------- |
| 前端展示真实模型能力、原有 wire 选择 | 沿用 [ADR-0029](../../docs/adr/0029-desktop-package-structure.md) | UI 仅消费配置事实，协议及 Core 所有权不变 |
| Pencil 几何、主题及响应式样式        | 无需 ADR                                                          | 可逆的组件呈现调整，约束归 DESIGN.md      |

## 验证记录

基线提交：0c177d0ef6f936de39f3caeba53e369194bc0ef4。开发分支 feat/pencil-conversation-sync 从已获取 origin/main 创建。只由主代理执行验证；其他代理仅调查事实。

尚无本任务通过的验证证据。首次验证：现有 shell/Transcript/dock/composer 布局用例和新增真实 Composer 布局保护用例建立基线，再用公开 Composer 菜单用例复现 C06/C07 差异。随后完成受影响 Chromium 用例、一次 desktop 包级验收、check:dev 和 agent-browser Light/Dark/窄屏验收。浏览器使用脚本 wire 和 mock DesktopHost，不启动真实 Electron。

### 已运行

- 初始根目录 `vitest run --project ui-browser ...` 未收集测试：根配置嵌套项目未匹配该筛选。改为 packages/ui 目录的直接 Vitest 配置，不改变 runner；日志 `/tmp/rukie-pencil-baseline.log` 最终保存正常基线运行。
- 基线：packages/ui 下 `env -u NO_COLOR ../../node_modules/.bin/vitest run --project ui-browser tests/app/shell.browser.test.tsx tests/app/transcript.browser.test.tsx tests/components/conversation-dock.browser.test.tsx tests/components/compact-composer.browser.test.tsx`，4 文件/31 用例通过，8.77s，修改前布局与交互基线。
- 公开 Composer 复现：`tests/components/composer.browser.test.tsx`，2 失败/1 通过，1.16s；缺 332px 模型表面和初始化详情。日志 `/tmp/rukie-pencil-repro.log`。
- 实现后局部验证发现默认菜单 zoom 动画影响几何、space-y 默认给并排面板增加额外间隙；模型专用容器改为稳定几何与显式 4px gap。已有 shell 12 用例通过。ThinkingLevel 含 automatic，触发器补充双语文案。日志 `/tmp/rukie-pencil-focused.log` 与 `/tmp/rukie-pencil-types.log`。
- 第二/三次局部运行：几何修复后模型布局/窄屏正常，但 Vitest browser 文本 matcher 对内联内容的处理不适合该子串断言，改为已可见元素 textContent 的精确子串断言；保留真实内容验证。日志 `/tmp/rukie-pencil-focused2.log` 和 `/tmp/rukie-pencil-focused3.log`。
- 第四次局部：模型三用例通过，新增权限几何用例在进场动画中测量提前；改为有界 expect.poll 等待实际宽度，不加固定延迟。日志 `/tmp/rukie-pencil-focused4.log`。权限动画保留。
- `bun run check:dev` 通过：格式、lint、tsc、Knip、tracker、docs、层次边界、测试策略、字阶。日志 `/tmp/rukie-pencil-static.log`。后续局部 CSS、测试和文档修改只增量检查失效项。
- 最终受影响 Chromium 范围（同基线四文件加真实 Composer）：5 文件/35 用例通过，8.53s，日志 `/tmp/rukie-pencil-acceptance.log`。覆盖模型键盘/取消/选择、详情、真实数据、长列表、自定义图标、主题、窄屏、权限和上下文；会话宽度与气泡调整后的外壳、审批、滚动用例保持通过。接下来首次 desktop 包级运行补齐 UI 共享呈现消费者证据，之后不重复此范围。
- `env -u NO_COLOR bun run test:desktop`：27 文件通过/1 文件失败，119 用例通过/2 失败，16.78s，日志 `/tmp/rukie-pencil-desktop.log`。两失败均为 layout.browser.test.tsx 的旧输入框宽度期望（720px），与用户确认的 C04 752px 冲突；只将 composer dock 上限由 768 改为 800（保留两侧 24px、其它区域及 1px 精度），没有放宽断言。其余包级证据继续有效。
- 双轴只读审查：Spec 无发现；Standards 找到非首推理档位键盘不可达、宽矮窗口详情无滚动和按钮 cursor 缺失。修复芯片键盘轮巡、详情 ScrollArea 约束、cursor/disabled/pressed/focus，补相应公开行为断言。
- 最小增量 `composer.browser.test.tsx + layout.browser.test.tsx`：6 通过/1 失败，2.06s，日志 `/tmp/rukie-pencil-incremental.log`。布局两用例和原模型用例通过；新增短窗口（1280×320、18px 字体）暴露 Radix 默认无碰撞留边，设置模型菜单 collisionPadding=16 后只重验该单例：1 通过/4 跳过，791ms，日志 `/tmp/rukie-pencil-short.log`。
- 审查修改后的 `oxlint`（3 个受影响 TS 文件）和 `tsc -b` 通过；文档检查与变更文件格式通过。只读审查和后续证据更新不要求重复已通过的包级测试。GUI 开始一次 agent-browser 验收，mock DesktopHost 与脚本 wire，端口随机分配。
- Standards 修复复核无新发现，Spec 轴无发现。ADR Coverage 复核完成：UI 显示/样式没有引入 Core 行为、权限、协议或持久化改变，沿用 ADR-0029；局部 Pencil 角色归 DESIGN.md，无新增 ADR。
- agent-browser 验收：真实 App + mock DesktopHost + 脚本 wire，1280×900 明暗与 420×900 窄屏；测量 composer 752×100、C06 332px、C07 280×184、间距4px，窄屏同宽上下排列、无横向溢出。操作模型键盘预览/选择与 Escape、权限菜单、上下文详情；上下文面板实测348px且保留真实统计。控制台无产品异常、无页面错误；开发验收临时 HTML 无 favicon，唯一404为 favicon.ico。宽转窄时既有侧栏覆盖模型入口，关闭侧栏后正常操作，保留原遮罩行为。截图在外部证据目录 pencil-conversation-sync/light.png、dark.png、narrow.png（Codex visualization 本任务目录）。浏览器、Vite、wire 父子进程已退出，临时验收入口移除，端口63230/5173无监听。
- 本地交付证据为首次 desktop 包级119通过/2布局旧期望失败，加后续受影响布局、模型与新增短窗口通过；未把初次失败的包级运行改称全绿，未重复无失效证据的包级测试。最新 PR CI 待外部验收，尚未合并。
- 最后品牌映射改为 Map，避免自定义供应商名称命中对象原型属性；仅重验模型公开行为单例（包括品牌、选择、取消、键盘High与焦点）：1通过/4跳过，1.03s，日志 `/tmp/rukie-pencil-model-final.log`。屏幕正常视觉未变化，复用浏览器截图。增量 lint、tsc、docs、tracker、test-policy、格式和 diff 检查通过。
