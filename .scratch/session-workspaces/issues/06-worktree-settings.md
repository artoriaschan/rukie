# 06：设置 → 环境 → 工作树

Status: resolved

Blocked by: 05

**What to build:** 按 [spec](../spec.md#工作树设置工单-06) 与 rukie.pen“设置 12 · 工作树”，列出、刷新并删除 rukie 创建的工作树。

- [x] wire `worktrees.list`、`worktrees.refresh`、`worktree.delete`；刷新移除失效记录并 `git worktree prune`
- [x] 删除：绑定 Session 忙碌返回 `session_busy`；`git worktree remove --force`，保留分支，清除 `worktreeId` 并把绑定 Session 移回主目录
- [x] 启用设置导航“工作树”；页面：标题、分区“独立工作树”与说明、“刷新”、列表行（分支图标、分支名、仓库名标签、路径、“删除”）、空状态
- [x] 删除弹窗：标题“删除独立工作树”，正文含路径与分支，“取消”“删除”（destructive），忙碌错误在弹窗内显示
- [x] zh 与 en 文案同步；DESIGN.md 记录列表行与弹窗
- [x] 测试：server wire 覆盖列表、刷新清理外部删除、删除与 Session 移回、忙碌拒绝；UI browser 覆盖列表、刷新、弹窗文案、取消、删除与错误；layout gate；完成后 agent-browser 验收 Light/Dark/窄宽度
- [x] 文档：server README、ui README

## Comments

- Implemented wire list/refresh/delete, existing-directory filtering, source prune, forced removal with retained branch, bound Session admission/external lease protection, main-directory move and lazy recovery after refresh. Git failure preserves record/binding for retry.
- Settings Environment → Worktrees enabled (compact icon rail at narrow width), localized list/refresh/empty/deletion dialog and inline busy error; installed beUI Button/MorphingModal and existing shadcn ScrollArea reused. DESIGN and owning READMEs updated.
- Focused evidence: `/tmp/rukie-session-workspaces-evidence/06-verification.md`. Ticket stays claimed pending integration-wide review, final verification and joint spec closure. Root owns aggregate/static, final manual Chromium acceptance and cleanup.

- Review 修正：`fix/session-workspaces-review` 补齐 Project 移动/删除串行边界、工作树删除期间实际 Core 写者租约与重启前自动修复，以及 canonical workspace 祖先 inode/dev 校验。公开 server/Core reproducer 先红后绿；详细命令、原始失败、增量验证与责任边界见 `/tmp/rukie-session-workspaces-evidence/review-fixes-verification.md`。保留 claimed，最终验收与关闭由集成负责人执行。

- GUI 验收修正：删除确认 Button 复用现有 Project 移除确认的 36px soft-destructive 样式，修复 Light/Dark 实心危险色。公开 App Chromium 先复现颜色错误，最终两个现有参数用例均通过（2.95s），覆盖实际背景/前景、hover、pending disabled/键盘重复提交与原设置几何断言。变更文件格式与 lint 通过；详细原始失败、最小增量范围见 `/tmp/rukie-session-workspaces-evidence/gui-style-fix-verification.md`。仍为 claimed；集成负责人负责修正后弹窗 GUI 验收及统一关闭。

- GUI 尺寸修正：取消按钮移除 `size="sm"`，复用现有 beUI Button 默认 32px 高度，保留 36px Delete 与已验证颜色/交互。现有 Light/Dark App Chromium 两例先红（实际 28px）后绿（2 passed，2.98s），增加精确 Cancel 32px 断言；已有设置几何断言通过。详细增量证据见 `/tmp/rukie-session-workspaces-evidence/cancel-size-verification.md`。仍为 claimed；最终弹窗 GUI 验收与统一关闭由集成负责人执行。

## Final delivery evidence

- 2026-10-15：六个工单的实现、受影响文档、评审修复与适用本地验证完成；本工单与 spec 在同一变更设为 resolved。集成分支 `feat/session-workspaces`，PR #25 待最终推送、CI 与用户 review；resolved 不表示 CI 已通过或 PR 已合并。
- Standards / Spec review 的三个 P1 已由新修复代理处理，公开 Core / server reproducer 先红后绿；新 targeted reviewer 确认全部修正且没有剩余 actionable finding。详细记录：`/tmp/rukie-session-workspaces-evidence/review-corrections.md`、`review-fixes-verification.md`。
- 复用本工单现有 focused 证据与跨模块增量记录：Bun 514 pass / 0 fail + Agent e2e 1470 / 0；coding-agent 原全量 1528 / 16，全部 16 个旧权限 fixture 失败经六文件 212 / 1 与最后修正例 1 / 0 获得通过证据。Release 113 / 0；Desktop Node 70 通过，Chromium 原包 200 / 5，修正五例 5 / 0。工作树弹窗颜色修正 2 / 0，取消按钮尺寸修正 2 / 0。未声称全量重新通过。
- 最终 isolated Chromium GUI：实际对话创建/移动/删除、工作树创建/列表/刷新/取消/删除及 Session 回主目录、三入口菜单、Project 移除确认、Light/Dark/窄宽度、键盘/cursor/disabled、console/network 与清理通过。弹窗最终复验基于 `20b6e9aa`：Cancel 32px、Delete 36px，软危险色及 hover 正确，宽 448px / 窄 388px 无溢出，取消初始焦点与 Enter 取消保留工作树。详见 `gui-verification.md`、`gui-dialog-final.md`；未做真实 Electron、系统钥匙串或文件夹选择器视觉验收。
- ADR Coverage 审阅完成：决定、链接、accepted 状态与最终实现一致；工作树 host 根扩展由 ADR-0045 定义、ADR-0037 已链接承接。查看 [spec ADR Coverage](../spec.md#adr-coverage)。最终合同审阅与文档/tracker 命令记录：`/tmp/rukie-session-workspaces-evidence/delivery-verification.md`。
