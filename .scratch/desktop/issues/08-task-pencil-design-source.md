# 08: 确定 Pencil 视觉稿来源

Type: task

Blocked by: None

Status: resolved

## Question

桌面端布局参考哪个 Pencil 文件和哪些画板？本机已发现的候选：

- `~/Desktop/Meezii.pen`
- `~/.pencil/documents/1c320bdd-1847-40d6-8b9b-84b0318ddc6b/pencil-new.pen`
- `~/Workspaces/person/pulsar-prototype/pages.pen`
- `~/Workspaces/person/pulsar-prototype/renderers.pen`

人工确认文件与画板后，记录路径，以及 MVP 对应的画板清单（主窗口、Session 列表、对话、工具调用、权限确认）。

## Answer

视觉稿来源：`~/Desktop/rukie.pen`（用户确认；Pencil 2.19，143 个顶层画板）。深色为默认，`L-` 前缀为对应浅色版本。仓库不纳入该文件，按路径与画板名引用。

MVP 参照画板：

- 外壳与规范：`M01-A · C01 应用外层壳`、`01 · 交互流程与组件说明`、`F01 · shadcn 基础 UI / 唯一维护源`（浅色 `F02`）
- 项目与 Session：`M02-A · 会话侧栏与右键菜单`、`H01 · 首页-新会话`、`H02 · 首页-添加项目`、`H05 · 首页-会话菜单`
- 输入与权限：`C04 · 主输入框`、`C05 · 权限模式`、`H07 · 首页-会话-模式`
- 对话阅读：`H03 · 首页-项目菜单` 中的会话内容（含“用户批准消息”“正在执行说明”）、`H08 · 首页-会话-Turn指示器`

不属于 MVP 的画板：标签页（`H09`–`H12`、`C20`–`C21`）、设置（`S01`–`S20`、`C03`）、模型服务（`P00`–`P08`、`C10`–`C17`）、模型切换（`C06`/`C07`/`H14`）、上下文详情（`C08`/`H15`）、插件与工具（`C09`/`H06`/`H16`）、用户菜单（`H13`）。

缺口：按节点名检索，未发现工具调用块（Bash 输出、文件编辑 diff）与权限 Interaction 审批卡片（批准/拒绝）的专门画板；`H12` 只有代码审查器 diff。这两项由主界面粗稿补齐。
