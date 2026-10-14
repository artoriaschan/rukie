# 03：“移到项目”换项目、移出与选择文件夹

Status: claimed

Blocked by: 02

**What to build:** 按 [spec](../spec.md#移到项目工单-03)，扩展 `session.move` 与会话菜单。

- [x] `session.move` 的 `projectId` 改为 `string | null`；`null` 创建新的 `workspace/<id>/` 作为目标 cwd 并删除绑定；已在“对话”时拒绝
- [x] `sessionActions` 子菜单：其他 Project、“移出项目”（仅项目会话）、分隔线、“选择文件夹…”；右键、行内更多、标题栏一致
- [x] “选择文件夹…”：选择单个目录，经信任确认后 `project.create`；主目录相同返回已有 Project 后移入，`project_conflict` 显示冲突，取消不创建不移动；移动失败保留已建 Project
- [x] zh 与 en 文案同步
- [x] 测试：server wire 覆盖移出、重复移出拒绝、移出后删除清理新目录；UI browser 覆盖三入口新菜单项、选择文件夹的已有/冲突/新建/取消路径
- [x] 文档：server README、ui README 的 `session.move` 合同

## Comments

- 2026-10-14：fresh implementer on `feat/session-workspaces-03`, integration baseline `6adbd5b4`; nullable move allocates an empty owned directory, removes binding after Core move, and cleans its allocation if move fails. All three shared menus expose other Projects, project-only move-out, separator and choose-folder; busy gating retained. Choose-folder requests a single directory (`pickProjectFolder(false)`), confirms trust before `project.create`, uses its returned Project id and preserves created Projects on move failure. Host contract updated across browser wire, macOS executor and Electron main/preload; existing Project creation keeps multi-selection. Existing installed beUI context items/separator and shadcn dropdown composition reused, no custom primitive or geometry token introduced.
- Verification: server behavioral red `invalid_command` for nullable move, then 1 pass (95 ms); related move/host subset originally 7 pass / 1 fail from an obsolete nullable rejection assertion, then corrected public case 1 pass (91 ms). Chromium initial menu behavioral red missing Choose folder, then 5 pass (4.67 s). Six folder cases first had missing viewport setup; fixed viewport reproduced single-picker argument red. Folder/public file subsequently 9 pass / 2 assertion failures; full localized error strings corrected, affected 2 pass (2.17 s). Extended Project move-out across three entries 1 pass (2.72 s). Browser-host single-picker plus shared F01 consumers 5 pass (2.11 s). Electron mock main/preload 13 pass (859 ms), no real Electron/keychain. Full logs and source validity in external `03-verification.md`; root owns final static/aggregate/browser acceptance, review and closure.
- Layout: existing menu case preserves title bar, main and navigation geometry within 1 CSS px while opening all entrances; existing narrow Dark/zh keyboard case passed. Authorized changes only add menu rows and existing trust dialog content. No shell/sidebar/composer styles or shared primitive geometry changed. ADR-0042 owns move-out directory lifecycle, ADR-0043 binding, ADR-0040 Core move; local menu/picker changes need no new ADR. Worktree binding disable remains owned by 05. Status remains claimed pending integration acceptance.

- Review 修正：`fix/session-workspaces-review` 补齐 Project 移动/删除串行边界、工作树删除期间实际 Core 写者租约与重启前自动修复，以及 canonical workspace 祖先 inode/dev 校验。公开 server/Core reproducer 先红后绿；详细命令、原始失败、增量验证与责任边界见 `/tmp/rukie-session-workspaces-evidence/review-fixes-verification.md`。保留 claimed，最终验收与关闭由集成负责人执行。
