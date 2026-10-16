# 05：清理未使用和违规的组件，产品层按钮统一用 Button

Status: resolved
Blocked by: 04

**What to build:** 每个角色只保留一个实现，删除规范不允许的装饰组件，产品层的操作统一使用 Button 原语。见 [spec](../spec.md) 中的「共享原语」一节。

## 任务

- [x] 删除以下组件，并删除它们在 `components/index.ts` 中的命名空间导出。下面列出的组件没有产品消费者；实际盘点发现 StatefulButton 和 center-morph-modal 仍有专属测试，随实现删除这些过时消费者并保留基础角色的有效覆盖。跨包只导入 `DesktopHost` 类型（基线 `cc17c80b`）。
  - `motion/button/stateful.tsx`、`metallic.tsx`、`magnetic.tsx`，以及 `motion/magnetic.tsx`（如果没有其他消费者）。
  - `motion/drawer.tsx`、`motion/center-morph-modal.tsx`。
  - `agents/loading-states/reasoning-text.tsx` 及其独占的 `motion/text-scramble.tsx`。理由：DESIGN.md 的 Motion 一节规定，只在真实运行期间使用 Agent Loading States 或 Text Shimmer。
- [x] 删除后再次检查 `components/index.ts` 中的其余命名空间，例如 `actionSwap`、`actionSwapRoll`、`loader`。没有消费者，或违反 Motion 规则的，一并删除。保留的项要在 Comments 中写明消费者。
- [x] 把产品层的原生 `<button>` 改用 Button 或已安装的原语：
  - `app/index.tsx:1194`（侧栏遮罩）和 `app/index.tsx:1279`（欢迎页 Project 下拉触发器）。
  - `app/new-chat-selector.tsx:163`、`:180`、`:234`。
  - `components/sidebar.tsx:99`、`:164`。
  - `components/project-row.tsx:265`。

  无法改用的，例如遮罩这类只用于关闭的覆盖层，在 Comments 中逐项写明原因，并确认它的光标、焦点和可访问名称符合规范。

- [x] 注册库原语（switch、radio、checkbox、select、context-menu、preview-rail、command-palette）自己负责内部的原生按钮，保持不变。agents/* 复合组件中的普通操作改用 Button。
- [x] 运行 Knip，确认没有残留的未使用文件、导出或依赖。如果依赖有变化，同步更新 `docs/tech-stack.md` 和 lockfile。
- [x] 测试：在受影响的 sidebar、new-chat-selector、project-row、shell 套件中补充或更新 Button 的光标、焦点和可访问名称断言，然后运行这些受影响的文件。
- [x] 运行变更文件的 lint、类型检查、Knip 和格式检查。用 agent-browser 对侧栏、新聊天选择条和欢迎页做局部验收。

## Comments

### 修改前授权与影响表

公开测试边界沿用 spec 已确认的真实浏览器 DOM/几何/语义/指针键盘交互和 App/wire，不新增私有测试 seam。

| 范围                      | 基线与授权差异                                                                                                   | 保留合同与验证                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 未用组件                  | 删除指定 Stateful/Metallic/Magnetic/drawer/center-modal/reasoning-text/text-scramble；基线“无测试消费者”已过时   | 删除专属测试；保留 Input 校验、Button 和静态 ActionSwap 行为覆盖                                    |
| 传递清理                  | 删除无产品消费者的 AgentProgress、Message、MessageScroller、CodeBlock、Loader、use-hover-capable 与 SPRING_MOUSE | 保留独立 MessageSideContext、PreviewRail、AgentCode、TextShimmer；Knip 核对实际依赖，不凭名称删包   |
| 侧栏 Session/Project/分类 | 原生操作迁移现有 Button，显式 compact/contextual；Session/Project 最小32、分类28；原有14px和insets不变           | 保留透明静态行、当前语义、折叠、hover尾部操作、焦点与上下文菜单；sidebar/project-hover/project-menu |
| 新聊天选择条              | 原生清除/Project/branch改 Button，显式 icon/compact；40px条、32px触发器、24px清除、8px触发器圆角保持             | 名称、禁用实际阻断、嵌套光标、菜单焦点、选择与错误；new-chat-selector                               |
| 欢迎页                    | Project触发器用 Button contextual，保留继承h1字号、无额外padding和原高度                                         | App shell欢迎切换与上下文菜单；不移动shell/composer                                                 |
| agents普通操作            | 原生与motion.button统一 Button icon/contextual/compact；移除无作用motion按钮transition                           | 保留现有28px摘要行、正文层级、ARIA、回调、披露与复制；icon操作按明确24px规范修正                    |
| 侧栏关闭遮罩              | 保留原生button：覆盖层需铺满workspace且不能采用可视Button尺寸/外观                                               | 增加type、pointer、2px可见焦点；保留本地化名称与键盘关闭；shell窄屏覆盖                             |

保留 actionSwap/actionSwapRoll：实际 TodoList、ToolResult、ApprovalCard 消费 ActionSwapRollText，其静态 keyed span 实现没有装饰运动。其余命名空间逐项实际消费者会写入交付证据。复用04包级+增量证据，仅本票触及行为做focused；无包级/check:dev授权。新依赖和原生Electron不在范围。

### 保留命名空间与实际消费者

| 命名空间                    | 当前消费者（省略公开 barrel）                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| button                      | App、model-services、project-row、sidebar、composer、agents普通操作；只导出Button/ButtonLink及类型                                   |
| popover                     | project-row、composer                                                                                                                |
| tooltip                     | App、model-services、project-directories、new-chat-selector、project-row、goal-status、composer、sidebar、prompt-input、preview-rail |
| commandPalette              | App搜索面板                                                                                                                          |
| contextMenu                 | session-actions、project-row、sidebar                                                                                                |
| morphingModal               | worktree-settings、rename-session、model-services、project-dialog、goal-confirmation、delete-session                                 |
| select                      | model-services、prompt-input                                                                                                         |
| streamingResponse           | Transcript                                                                                                                           |
| thinkingShimmer             | Transcript、AgentActivity；TextShimmer仍有真实running消费者                                                                          |
| agentActivity               | Transcript                                                                                                                           |
| toolResult / fileDiff       | tool-row                                                                                                                             |
| toolApproval                | Transcript、conversation-dock                                                                                                        |
| approvalCard                | question-dock、plan-review-dock                                                                                                      |
| promptInput                 | composer                                                                                                                             |
| todoList                    | conversation-dock                                                                                                                    |
| dropdownMenu                | App、model-services、new-chat-selector、model-picker、session-actions、composer、sidebar                                             |
| citations                   | StreamingResponse；引用跳转保留本地化名称                                                                                            |
| messageBubble               | Transcript；独立MessageSideContext继续被MessageBubble消费                                                                            |
| input                       | rename-session、model-services、project-create/edit、ApprovalCard/Interaction                                                        |
| actionSwap / actionSwapRoll | 静态ActionSwapRollText由TodoList、ToolResult、ApprovalCard使用；ActionSwapButton有无动画键盘/指针测试                                |

传递清理：Knip发现的无消费者EASE_IN_OUT删除；useAgentCodeTokens和PreviewRailItem仍在各自模块内部使用，仅取消export。删去19组专属旧组件本地化键（zh/en同时）；motion、radix-ui、FloatingUI、Shiki及其它当前依赖仍有真实消费者，依赖和lockfile无需变更。

### 实现与验证结果

- 删除13个无产品消费者或禁止装饰的组件文件、独占use-hover-capable，以及center-modal专属测试；精简Button导出和公开命名空间。原生与motion.button普通操作已统一现有Button并显式选择角色。静态ActionSwap及消费者保留；未新增依赖、兼容层或替代原语。
- 侧栏关闭遮罩保留原生button，补充type、pointer、2px键盘焦点，并在关闭后把焦点返回标题栏侧栏开关。公开失败先行分别复现工具摘要default光标、遮罩default光标和关闭后body焦点丢失；均由所属实现修复。
- 基于04的focused13文件原运行：7失败/6通过、56失败/31通过；缺失NewChatSelector的Button导入造成App统一失败，修复后7文件56通过/1失败，剩余新焦点断言先修正键盘模式，再复现并修复实际焦点返回缺陷。最终受影响Shell两例通过；新增欢迎菜单Enter/Escape、选择条禁用指针/Enter/Space断言通过；引用本地化用例通过。原失败记录保留，未将其改称整套通过。
- 07先集成了相同的四个Trace/Button owner变更。本票保留07文件原样，复用其32例focused与真实浏览器证据；合并本票ToolRow公开断言后最小单例通过。06最新tip无冲突整合，保留真实主题owner。所有共享包证据按04/07验证记录复用；本票未重复package或check:dev。
- 当前变更文件format、oxlint、类型、Knip及tracker/docs（155 Markdown）、test-policy、typography通过。无未使用依赖或残余未使用文件/导出；未改lockfile或tech-stack。
- Chromium实际Light/Dark1280×900、Dark420×900及420×700/18px验收：侧栏/Project/Session/分类、欢迎菜单、Project/branch选择及清除、键盘focus/Enter/Space/Escape/ArrowRight、disabled/nested cursor均按有效范围检查；268px侧栏、32px行、28px分类、40px条、752px宽composer保持，窄屏scrollWidth420。console仅Vite/React信息，errors为空，资源请求均200。7截图及5computed记录在外部05证据目录；浏览器、launcher和任务临时git目录已清理，未触及原有IPv6进程。
- 浏览器发现已有分支名宽度缺陷：1280px、Project Acceptance、main分支时Tooltip87.203125px内按钮仅43.59375px，文本0px；临时恢复原生class仍相同，非本票Button迁移造成。主代理明确交08修复，证据见外部05-browser-findings.md。本票未改该宽度。真实fake回复已显示；自然Run结算未在有界等待内确认，显式Stop后观察到已结算UI，本票不据此声称自然结算通过。
- ADR coverage：沿用spec的组件来源和布局/交互规范；删除无消费者实现与现有Button机械迁移没有新增架构取舍，无需新ADR。Native Electron、系统钥匙串和目录选择器未启动。PR/CI由主代理交付，尚未据此声称远端验收或合并。
