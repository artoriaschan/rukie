# 05：Git Project 新 Session 的独立工作树

Status: ready-for-agent

Blocked by: 02, 03

**What to build:** 按 [spec](../spec.md#独立工作树工单-05) 与 [ADR-0045](../../../docs/adr/0045-git-worktree-sessions.md)，新建 Git Project Session 时可选独立工作树。

- [ ] `project.git` 查询：主目录为仓库顶层时返回当前分支与 HEAD
- [ ] `session.create` 的 `worktree` 选项：创建 `<dataRoot>/worktrees/<短id>/<仓库名>` 与分支 `rukie/worktree-<短id>`，写入工作树记录与绑定 `worktreeId`；失败返回 `worktree_failed` 且不创建 Session
- [ ] 工作树 Session 的附加目录、信任派生与跳过懒同步；拒绝 `session.move`；摘要新增 `worktree`
- [ ] 删除工作树 Session、移除 Project 均保留工作树；sidecar 显示与终端允许已记录的工作树目录
- [ ] 新聊天：选择 Git Project 后显示当前分支与“使用独立工作树”开关及提示；非 Git Project 不显示；失败保留选择并显示错误；“移到项目”置灰
- [ ] zh 与 en 文案同步；DESIGN.md 记录开关与提示样式
- [ ] 测试：server wire 用临时 Git 仓库覆盖查询、创建、分支冲突重试、失败不建 Session、信任派生、移动拒绝、删除 Session 保留工作树；UI browser 覆盖开关、提示、失败与禁用
- [ ] 文档：CONTEXT.md 独立工作树词条、server/desktop README

## Comments
