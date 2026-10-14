# 06：设置 → 环境 → 工作树

Status: claimed

Blocked by: 05

**What to build:** 按 [spec](../spec.md#工作树设置工单-06) 与 rukie.pen“设置 12 · 工作树”，列出、刷新并删除 rukie 创建的工作树。

- [ ] wire `worktrees.list`、`worktrees.refresh`、`worktree.delete`；刷新移除失效记录并 `git worktree prune`
- [ ] 删除：绑定 Session 忙碌返回 `session_busy`；`git worktree remove --force`，保留分支，清除 `worktreeId` 并把绑定 Session 移回主目录
- [ ] 启用设置导航“工作树”；页面：标题、分区“独立工作树”与说明、“刷新”、列表行（分支图标、分支名、仓库名标签、路径、“删除”）、空状态
- [ ] 删除弹窗：标题“删除独立工作树”，正文含路径与分支，“取消”“删除”（destructive），忙碌错误在弹窗内显示
- [ ] zh 与 en 文案同步；DESIGN.md 记录列表行与弹窗
- [ ] 测试：server wire 覆盖列表、刷新清理外部删除、删除与 Session 移回、忙碌拒绝；UI browser 覆盖列表、刷新、弹窗文案、取消、删除与错误；layout gate；完成后 agent-browser 验收 Light/Dark/窄宽度
- [ ] 文档：server README、ui README

## Comments

- Implemented wire list/refresh/delete, existing-directory filtering, source prune, forced removal with retained branch, bound Session admission/external lease protection, main-directory move and lazy recovery after refresh. Git failure preserves record/binding for retry.
- Settings Environment → Worktrees enabled (compact icon rail at narrow width), localized list/refresh/empty/deletion dialog and inline busy error; installed beUI Button/MorphingModal and existing shadcn ScrollArea reused. DESIGN and owning READMEs updated.
- Focused evidence: `/tmp/rukie-session-workspaces-evidence/06-verification.md`. Ticket stays claimed pending integration-wide review, final verification and joint spec closure. Root owns aggregate/static, final manual Chromium acceptance and cleanup.
