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

- Review 修正：`fix/session-workspaces-review` 补齐 Project 移动/删除串行边界、工作树删除期间实际 Core 写者租约与重启前自动修复，以及 canonical workspace 祖先 inode/dev 校验。公开 server/Core reproducer 先红后绿；详细命令、原始失败、增量验证与责任边界见 `/tmp/rukie-session-workspaces-evidence/review-fixes-verification.md`。保留 claimed，最终验收与关闭由集成负责人执行。

- GUI 验收修正：删除确认 Button 复用现有 Project 移除确认的 36px soft-destructive 样式，修复 Light/Dark 实心危险色。公开 App Chromium 先复现颜色错误，最终两个现有参数用例均通过（2.95s），覆盖实际背景/前景、hover、pending disabled/键盘重复提交与原设置几何断言。变更文件格式与 lint 通过；详细原始失败、最小增量范围见 `/tmp/rukie-session-workspaces-evidence/gui-style-fix-verification.md`。仍为 claimed；集成负责人负责修正后弹窗 GUI 验收及统一关闭。

- GUI 尺寸修正：取消按钮移除 `size="sm"`，复用现有 beUI Button 默认 32px 高度，保留 36px Delete 与已验证颜色/交互。现有 Light/Dark App Chromium 两例先红（实际 28px）后绿（2 passed，2.98s），增加精确 Cancel 32px 断言；已有设置几何断言通过。详细增量证据见 `/tmp/rukie-session-workspaces-evidence/cancel-size-verification.md`。仍为 claimed；最终弹窗 GUI 验收与统一关闭由集成负责人执行。
