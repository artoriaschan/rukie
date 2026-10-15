Status: claimed

# Spec: 新聊天选择条按 M03-A 实现

## Problem Statement

[session-workspaces](../session-workspaces/spec.md) 工单 05 把新聊天界面限定为“C34 子集”：只显示当前分支与独立工作树开关。rukie.pen 的 M03-A 是新聊天选择条、项目菜单与分支菜单的唯一维护源，当前实现缺少与主输入框同宽的选择条、项目图标悬停为 x、项目菜单搜索与选中标记、分支菜单的全部本地分支、搜索、切换和“创建并检出新分支…”。工作树删除确认的“删除”被改为 soft destructive，与 C36 设计稿的实心危险色不符。

## Solution

- C32：新聊天时主输入框上方显示同宽选择条，左侧项目触发器，项目态右侧分支触发器；会话创建后隐藏，打开已有会话不显示。
- C33：项目菜单带搜索、当前项勾选、“添加新项目”和“不使用项目”。
- C34：分支菜单列出主目录全部本地分支，支持搜索、切换、“创建并检出新分支…”与“使用独立工作树”。
- C36：工作树删除确认的“删除”使用实心 destructive。

## User Stories

1. 作为用户，我希望新聊天时在主输入框上方看到同宽的选择条，显示当前是“对话”还是某个项目。
2. 作为用户，我希望选中项目后，悬停或聚焦项目图标时它变为 x，点击 x 只取消本次项目选择、回到对话，不打开菜单。
3. 作为用户，我希望项目菜单可以搜索项目、看到当前项的勾选，并能“添加新项目”或“不使用项目”。
4. 作为用户，我希望分支菜单列出项目主目录的全部本地分支，当前分支有勾选，并能按名称搜索。
5. 作为用户，我希望点击分支后主目录切换到该分支，选择条回显新分支。
6. 作为用户，我希望用搜索框输入的名称“创建并检出新分支…”。
7. 作为用户，我希望主目录有冲突的未提交改动或项目会话正在执行时，切换和新建分支被拒绝并显示原因。
8. 作为用户，我希望启用独立工作树后选择条回显“分支名 · 独立工作树”，菜单显示源分支说明。
9. 作为用户，我希望删除独立工作树的确认按钮是实心红色。
10. 作为键盘用户，我希望两个菜单都可以搜索、方向键导航、Enter 选择、Escape 关闭并恢复焦点；长名称单行省略并在 tooltip/无障碍名称中保留完整值。

## Implementation Decisions

### server

- `WireProjectGit` 增加 `branches: string[]`：`git for-each-ref --format=%(refname:short) refs/heads` 的本地分支，按名称排序；非仓库为空数组。
- 新 wire 命令 `project.checkout { projectId, branch }` 与 `project.createBranch { projectId, branch }`，返回新的 `WireProjectGit`。Git 以参数向量执行：切换 `git switch <branch>`（分支必须在本地分支列表中），新建先 `git check-ref-format --branch` 校验，再 `git switch -c <branch>`。
- 准入：项目存在、主目录为仓库顶层；绑定该项目且 cwd 为主目录（非工作树）的 Session 执行中、等待 Interaction、正在组织或被其他进程占用时返回 `session_busy`；通过 Project 变更队列串行。
- 失败：分支名非法或已存在返回 `branch_invalid`；Git 拒绝（未提交改动冲突等）返回 `git_failed { message }`，不强制、不 stash。成功后发布 `sessions_changed`。
- 只操作本地分支，不 fetch、不处理远端分支。

### UI

- 选择条：`max-w-[800px]` 底部容器内、Composer 上方；40px 高、4px 内边距、上方 12px 圆角，`surface` 背景向下延伸 16px 至 Composer 圆角后方，Composer 位置与圆角不变。仅 `!state.selected` 显示。
- 项目触发器：图标（对话 `message-square`、项目 `folder`）、名称、chevron；项目态悬停或 focus-within 时图标换为 x，x 为独立 24px 按钮（名称“取消项目选择”），点击 `store.select(null, null)`。
- C33：288px，DropdownMenu；顶部搜索输入（阻止 Radix typeahead 吞键，方向键下移到第一项），项目行带右侧勾选；分隔线后“添加新项目”（现有添加流程）、“不使用项目”。无结果显示空状态。移除原菜单中的“编辑项目”。
- C34：320px，向上展开；搜索输入、分隔线、“分支”组标题、分支行（mono、勾选当前分支）、分隔线、“创建并检出新分支…”、“使用独立工作树”勾选项与说明。“创建并检出新分支…”在搜索内容非空且不等于已有分支时执行新建，否则聚焦搜索框并显示“输入新分支名称”提示。列表过长内部滚动。切换中禁用菜单项，失败在既有 alert 区显示。
- 分支触发器文本：`<branch>`，启用工作树时 `<branch> · 独立工作树`；detached HEAD 显示 8 位提交。
- 工作树删除确认按钮恢复 `variant="destructive"` 实心样式。
- zh/en 同步；DESIGN.md 更新 C32/C33/C34 与 C36 规则，删除“branch switching, branch creation and search are absent”。

## Testing Decisions

- server：临时 Git 仓库覆盖分支列表、切换、新建、非法名、已存在、未提交冲突拒绝且工作区不变、项目会话执行中拒绝、工作树会话不阻塞。
- UI Chromium：选择条几何（与 Composer 同宽、Composer 位置不变）、x 取消、项目搜索与勾选、添加/不使用项目、分支列表与搜索、切换命令与回显、新建分支、失败 alert、工作树回显、会话创建后隐藏、窄宽度菜单不溢出、Light/Dark。
- 工作树删除按钮的颜色断言更新为实心 destructive。
- 完成后一次 agent-browser 验收。

## Out of Scope

- 远端分支、fetch、Git 图谱、删除分支、stash。
- 已有会话中切换分支。

## ADR Coverage

| 决定或修改                                      | 归属                                                          | 理由                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 新聊天在主目录执行本地 `git switch`/`switch -c` | 更新 [ADR-0045](../../docs/adr/0045-git-worktree-sessions.md) | 撤销“本次不做切换与新建分支”的备选结论，增加主目录检出的准入与失败语义 |
| 选择条、菜单、按钮样式                          | 无需 ADR                                                      | 局部交互与样式，由 DESIGN.md 与 rukie.pen M03-A 维护                   |
