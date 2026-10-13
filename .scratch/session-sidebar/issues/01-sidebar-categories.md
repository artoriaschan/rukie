# 01：侧栏三分类、行尾操作与滚动重构

Status: resolved

Blocked by: None (can start immediately)

**What to build:** 按 [spec](../spec.md#侧栏分类与会话行) 与 rukie.pen C02 重构首页会话侧栏：只有置顶、项目、对话三类，每个 Session 只出现一次；会话行 hover 显示置顶与更多 icon；建立会话菜单的单一操作定义，本票只含置顶/取消置顶，并接入右键、行内更多与标题栏三个入口；顶部固定、分类与 Session 在其下滚动并使用 A13 自定义滚动条。

- [x] 改动布局前按 DESIGN.md layout preservation gate 记录基线，在现有 layout browser 测试中先补齐侧栏几何断言：固定顶部、滚动区高度受限、滚动后顶部保持固定、自定义滚动条不占宽度、宽窄窗口与侧栏开关
- [x] 分组由纯函数推导：置顶集合内的 Session 归“置顶”，其余按工作目录等于 Project 路径归对应 Project，不匹配的归“对话”；顺序为置顶、项目、对话；移除“最近”分区；无置顶 Session 时不渲染“置顶”
- [x] 分类标题按 C02：收起时常显向右箭头，展开时 hover 显示向下箭头；hover 操作为置顶“更多”、项目“更多 + 添加项目”、对话“更多 + 新建会话”；分类内有执行中 Session 时持续显示加载 icon，与 hover 操作同时可见
- [x] 分类“更多”打开现有侧栏选项菜单；“显示”勾选项对应置顶、项目、对话，删除“最近”相关偏好语义
- [x] Project 列表与每个 Project 的 Session 列表超过 5 条时截断并显示“展开显示”；“置顶”与“对话”不截断；展开状态不持久化
- [x] 会话行标题末尾渐隐；hover 或行内聚焦时显示置顶/取消置顶 icon 与更多 icon；保留执行中、等待确认指示与 Ctrl 序号提示
- [x] 会话操作只有一份定义；会话行右键（beUI ContextMenu，锚定指针）、行内更多（shadcn DropdownMenu，末端对齐）与标题栏“会话更多”使用同一定义；会话行菜单不显示快捷键；本票菜单只有置顶/取消置顶
- [x] 侧栏滚动区使用现有 ScrollArea 与 A13 滚动条；顶部新聊天与搜索行固定，分隔线常显；侧栏 268 宽与外壳几何不变
- [x] zh 与 en 文案同步，移除不再使用的“最近”文案键；DESIGN.md 侧栏部分补充三分类、截断、行尾操作与菜单一致性规则
- [x] 测试：shell browser 覆盖分组推导、置顶分类显隐、Session 唯一出现、截断与展开、hover 与键盘聚焦行尾操作、右键与更多菜单内容一致、置顶切换；store 测试同步更新分组相关用例；重跑 shell、transcript、dock、composer 布局用例

## Comments

Implemented on `feat/session-sidebar-01`, based on the integration branch. Session grouping is derived once with pin ownership taking precedence over exact Project path matching. Project and Project Session expansion are independent local state. Existing beUI ContextMenu, shadcn DropdownMenu and ScrollArea are reused; the installed Radix Separator supplies the fixed divider. Session menu entries share one action definition, currently pin/unpin, with titlebar copy/open actions retained. No dependency changes.

Baseline: `layout.browser.test.tsx` passed both existing 1280×900 Light/14 and 420×700 Dark/18 cases before layout changes. The authorized differences are inside the sidebar; titlebar 44px, rail 52px, sidebar 268px and conversation/composer/approval geometry remain protected. Scroll cases cover fixed new-chat/divider, constrained viewport, overlay 8px track, wide/narrow windows and sidebar toggling. Long names use trailing fade and intrinsic inline-size containment, avoiding Radix measurement-table overflow.

Focused verification: related shell/layout/transcript/dock/compact-composer scope initially reported 34 passed and 4 failed (38 cases, 26.21s). The failures exposed long-title overflow, inactive ContextMenu roles blocking approval/composer focus, and a synchronous locator during DropdownMenu exit. After fixing those causes, 5 affected cases passed in 4.40s; the two sidebar scroll geometry cases passed in 2.08s. Store Node cases passed 10/10 in 589ms. The additional collapsed-running observation passed in the final disclosure case. All earlier unaffected results remain valid; the initial failed related run is not relabeled a full green. New menu coverage includes pointer origin, shared pin entries, hover/keyboard focus, Shift+F10, arrows, Escape restoration and Ctrl numbering. Process/transport and real browser interaction account for the focused menu integration cost over one second; tests use observable DOM/wire completion, without sleeps.

Changed-file format/lint, `tsc -b packages/ui`, `bun run check:docs` (147 Markdown files) and diff checks passed. Logs and the coordinating verification record are in `/tmp/rukie-session-sidebar-evidence/`, notably `01-baseline-layout.log`, `01-focused-browser.log`, `01-incremental-browser.log`, `01-scroll-final.log`, `01-focused-store.log` and `01-disclosure-collapsed.log`. Aggregate static checks, desktop package acceptance and one isolated agent-browser deliverable acceptance remain owned by ticket 06. Native Electron/keychain acceptance was not run.

ADR coverage: this ticket changes local navigation presentation and reuses existing UI primitives; it introduces no durable architectural decision. The spec's existing UI coverage entry applies. DESIGN.md owns the three-category, truncation, action, menu and scrollbar contracts; zh/en copy agrees. The spec stays claimed until its last ticket closes.
