---
status: accepted
---

# Git Project 的新 Session 可使用独立工作树

## 问题

同一 Project 的多个 Session 共用主目录，并行修改会互相干扰，未提交改动混在一起。用户需要在新建 Session 时选择从当前分支派生的隔离目录，并在设置中清理这些目录。

## 决定

只有主目录是 Git 仓库顶层（`git rev-parse --show-toplevel` 等于主目录真实路径）的 Project，新建 Session 时才可以选择独立工作树。server 从主目录当前分支（detached HEAD 时为当前提交）以 `git worktree add -b rukie/worktree-<短id> <目录> <源>` 创建工作树，目录为 `<dataRoot>/worktrees/<短id>/<仓库目录名>`；目录与分支的短 id 分别生成，分支已存在时重新生成。创建前不 fetch，主目录的未提交改动不进入工作树。创建失败时不创建 Session，界面保留选择并显示原因。

server 在应用 SQLite 记录 rukie 创建的工作树：id、所属 Project、源仓库路径、派生分支、目录与创建时间。Session 绑定（[ADR-0043](0043-session-project-binding.md)）增加可选 `worktreeId`；工作树与 Session 一一对应。绑定工作树的 Session：

- cwd 是工作树目录，附加目录为所属 Project 除主目录外的目录；Project 已信任时，server 把工作树目录并入派生的 `trustedProjects`（[ADR-0041](0041-desktop-project-explicit-trust.md)）。
- 不随 Project 主目录切换同步，不能 Session Move（“移到项目”禁用）。
- 删除 Session 只删除 Session，工作树与分支保留；移除 Project 级联删除 Session，工作树同样保留。

设置“工作树”页列出 rukie 创建且目录仍存在的工作树。删除工作树执行 `git worktree remove --force`，丢弃其中的未提交改动并保留派生分支；绑定 Session 执行中或等待 Interaction 时拒绝。删除成功后清除绑定的 `worktreeId`，并经 [ADR-0040](0040-session-move-transcript-boundary.md) 的 Session Move 把 Session 改绑到 Project 当前主目录。“刷新”移除目录已不存在的记录并对源仓库执行 `git worktree prune`；受影响的 Session 清除 `worktreeId`，下次打开时按 ADR-0043 同步到主目录。源仓库不存在时只移除记录。

sidecar 的显示与终端允许根（[ADR-0037](0037-browser-host-sidecar-capabilities.md)）增加已记录的工作树目录。`<dataRoot>/worktrees/` 位于应用数据根内，不能登记为 Project。

新聊天的分支菜单可以在主目录切换或新建本地分支。server 列出主目录可切换的本地分支（排除已被其他工作树检出的分支），以参数向量执行 `git switch <分支>` 或校验名称后执行 `git switch -c <分支>`，不 fetch、不 stash、不强制。主目录中绑定该 Project 的非工作树 Session 执行中、等待 Interaction 或被其他进程占用时拒绝；Git 因未提交改动冲突等原因拒绝时原样报告。切换完成后 post-checkout hook 失败不视为切换失败，以实际检出的分支为准。工作树 Session 不受主目录检出影响。

## 备选方案

- 工作树放在仓库同级目录：会在用户目录写入应用管理的数据。
- 工作树随 Session 删除：用户选择保留，由设置页统一清理。
- 一棵工作树承载多个 Session（“在此工作树中新建聊天”）：用户未选择，工作树只在新建 Session 时创建。
- 可配置根目录、创建前 fetch、按数量自动删除及删除前快照：本次不做。
- 分支菜单只显示当前分支和工作树开关：最初为避免改变主目录检出状态而采用；rukie.pen M03-A 要求列出全部分支、搜索、切换与新建，后续以上述准入与失败语义实现，不再采用。
- 切换前自动 stash 或 `--force`：会改写或藏起用户的未提交改动，因此由 Git 拒绝并报告。

## 影响

工作树中的改动只能经派生分支合回，删除工作树会丢失未提交改动，确认弹窗必须写明路径与保留的分支。Git 不可用或主目录不是仓库顶层时不提供该选项。切换主目录分支会影响之后在主目录工作的 Session，因此在其执行时拒绝。实施见[工单 05](../../.scratch/session-workspaces/issues/05-git-worktree-sessions.md)、[工单 06](../../.scratch/session-workspaces/issues/06-worktree-settings.md) 与[新聊天选择条工单](../../.scratch/new-chat-selector/issues/01-new-chat-selector.md)。
