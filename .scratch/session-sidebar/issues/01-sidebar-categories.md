# 01：侧栏三分类、行尾操作与滚动重构

Status: ready-for-agent

Blocked by: None (can start immediately)

**What to build:** 按 [spec](../spec.md#侧栏分类与会话行) 与 rukie.pen C02 重构首页会话侧栏：只有置顶、项目、对话三类，每个 Session 只出现一次；会话行 hover 显示置顶与更多 icon；建立会话菜单的单一操作定义，本票只含置顶/取消置顶，并接入右键、行内更多与标题栏三个入口；顶部固定、分类与 Session 在其下滚动并使用 A13 自定义滚动条。

- [ ] 改动布局前按 DESIGN.md layout preservation gate 记录基线，在现有 layout browser 测试中先补齐侧栏几何断言：固定顶部、滚动区高度受限、滚动后顶部保持固定、自定义滚动条不占宽度、宽窄窗口与侧栏开关
- [ ] 分组由纯函数推导：置顶集合内的 Session 归“置顶”，其余按工作目录等于 Project 路径归对应 Project，不匹配的归“对话”；顺序为置顶、项目、对话；移除“最近”分区；无置顶 Session 时不渲染“置顶”
- [ ] 分类标题按 C02：收起时常显向右箭头，展开时 hover 显示向下箭头；hover 操作为置顶“更多”、项目“更多 + 添加项目”、对话“更多 + 新建会话”；分类内有执行中 Session 时持续显示加载 icon，与 hover 操作同时可见
- [ ] 分类“更多”打开现有侧栏选项菜单；“显示”勾选项对应置顶、项目、对话，删除“最近”相关偏好语义
- [ ] Project 列表与每个 Project 的 Session 列表超过 5 条时截断并显示“展开显示”；“置顶”与“对话”不截断；展开状态不持久化
- [ ] 会话行标题末尾渐隐；hover 或行内聚焦时显示置顶/取消置顶 icon 与更多 icon；保留执行中、等待确认指示与 Ctrl 序号提示
- [ ] 会话操作只有一份定义；会话行右键（beUI ContextMenu，锚定指针）、行内更多（shadcn DropdownMenu，末端对齐）与标题栏“会话更多”使用同一定义；会话行菜单不显示快捷键；本票菜单只有置顶/取消置顶
- [ ] 侧栏滚动区使用现有 ScrollArea 与 A13 滚动条；顶部新聊天与搜索行固定，分隔线常显；侧栏 268 宽与外壳几何不变
- [ ] zh 与 en 文案同步，移除不再使用的“最近”文案键；DESIGN.md 侧栏部分补充三分类、截断、行尾操作与菜单一致性规则
- [ ] 测试：shell browser 覆盖分组推导、置顶分类显隐、Session 唯一出现、截断与展开、hover 与键盘聚焦行尾操作、右键与更多菜单内容一致、置顶切换；store 测试同步更新分组相关用例；重跑 shell、transcript、dock、composer 布局用例
