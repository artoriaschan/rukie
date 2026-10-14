# 05：Git Project 新 Session 的独立工作树

Status: resolved

Blocked by: 02, 03

**What to build:** 按 [spec](../spec.md#独立工作树工单-05) 与 [ADR-0045](../../../docs/adr/0045-git-worktree-sessions.md)，新建 Git Project Session 时可选独立工作树。

- [x] `project.git` 查询：主目录为仓库顶层时返回当前分支与 HEAD
- [x] `session.create` 的 `worktree` 选项：创建 `<dataRoot>/worktrees/<短id>/<仓库名>` 与分支 `rukie/worktree-<短id>`，写入工作树记录与绑定 `worktreeId`；失败返回 `worktree_failed` 且不创建 Session
- [x] 工作树 Session 的附加目录、信任派生与跳过懒同步；拒绝 `session.move`；摘要新增 `worktree`
- [x] 删除工作树 Session、移除 Project 均保留工作树；sidecar 显示与终端允许已记录的工作树目录
- [x] 新聊天：选择 Git Project 后显示当前分支与“使用独立工作树”开关及提示；非 Git Project 不显示；失败保留选择并显示错误；“移到项目”置灰
- [x] zh 与 en 文案同步；DESIGN.md 记录开关与提示样式
- [x] 测试：server wire 用临时 Git 仓库覆盖查询、创建、分支冲突重试、失败不建 Session、信任派生、移动拒绝、删除 Session 保留工作树；UI browser 覆盖开关、提示、失败与禁用
- [x] 文档：CONTEXT.md 独立工作树词条、server/desktop README

## Comments

- 2026-10-14：新 implementer 在 `feat/session-workspaces-05`、基线 `dad1e3c9` 实施。公开 seams：server WS/临时 Git 仓库、UI Chromium、store wire envelope；按 spec 的 Testing Decisions 授权。布局修改前既有 layout 6 cases 通过（3.05s），保留 shell/composer 几何，C34 只实现 branch/toggle/hint 子集。原始 query red 与 corrected UI trigger red、strict store red、worktree menu red 留在外部验证记录；最终工单状态由集成验收/审阅负责人关闭。

- 2026-10-14 实现证据：`project.git` 校验顶层/HEAD，Git 参数向量生成独立目录和分支，冲突重试与失败回滚；应用库工作树记录及绑定 `worktreeId`，摘要必填 `worktree` 并严格解析全部 UI 消费者。工作树 Session 排除主目录附加权限，派生 Project 信任、跳过懒同步、拒绝移动；删除 Session/Project 保留记录、目录和分支，host 允许记录路径。
- UI 复用已安装的 Button、DropdownMenu 和 CheckboxItem，满足 C34 当前分支/开关/提示角色，无新增组件或依赖；所有三入口 Move 禁用。同步 en/zh、DESIGN、CONTEXT、server/desktop README。ADR coverage：创建/记录/绑定/信任/生命周期遵循 ADR-0045，绑定懒同步沿用 ADR-0043，host 根扩展遵循 ADR-0037；局部 menu/style 无额外架构决定。
- 验证记录：server 公开 WS focused 六案例 6 pass / 0 fail，62 assertions，1.64s（新案例 408.54ms / 430.98ms / 148.01ms）；UI Chromium worktree-create + session-move + layout 20 pass / 0 fail，9.07s；UI Node store + client 20 pass / 0 fail，329ms。格式化 27 files 与 `git diff --check` 通过；后续仅格式及 TypeScript 注解/声明收窄调整，未改变运行逻辑。公开 wire 的 Git 场景用临时仓库；native host 用注入 executor，无真实 OS/keychain 启动。
- 原始失败证据：query missing red，UI corrected missing-trigger red，store malformed-worktree red，worktree Move enabled red；调试中 workspace/send aria 名称和完整 localized error 文案断言错误已更正，原始失败日志保留。所有日志及详细 evidence 位于协调方外部验证目录的 `05-verification.md`。未运行 final aggregate/static、desktop package 或 agent-browser（统一由主代理负责）；保留 claimed，待最终验收与审阅后统一关闭。

## Final delivery evidence

- 2026-10-15：六个工单的实现、受影响文档、评审修复与适用本地验证完成；本工单与 spec 在同一变更设为 resolved。集成分支 `feat/session-workspaces`，PR #25 待最终推送、CI 与用户 review；resolved 不表示 CI 已通过或 PR 已合并。
- Standards / Spec review 的三个 P1 已由新修复代理处理，公开 Core / server reproducer 先红后绿；新 targeted reviewer 确认全部修正且没有剩余 actionable finding。详细记录：`/tmp/rukie-session-workspaces-evidence/review-corrections.md`、`review-fixes-verification.md`。
- 复用本工单现有 focused 证据与跨模块增量记录：Bun 514 pass / 0 fail + Agent e2e 1470 / 0；coding-agent 原全量 1528 / 16，全部 16 个旧权限 fixture 失败经六文件 212 / 1 与最后修正例 1 / 0 获得通过证据。Release 113 / 0；Desktop Node 70 通过，Chromium 原包 200 / 5，修正五例 5 / 0。工作树弹窗颜色修正 2 / 0，取消按钮尺寸修正 2 / 0。未声称全量重新通过。
- 最终 isolated Chromium GUI：实际对话创建/移动/删除、工作树创建/列表/刷新/取消/删除及 Session 回主目录、三入口菜单、Project 移除确认、Light/Dark/窄宽度、键盘/cursor/disabled、console/network 与清理通过。弹窗最终复验基于 `20b6e9aa`：Cancel 32px、Delete 36px，软危险色及 hover 正确，宽 448px / 窄 388px 无溢出，取消初始焦点与 Enter 取消保留工作树。详见 `gui-verification.md`、`gui-dialog-final.md`；未做真实 Electron、系统钥匙串或文件夹选择器视觉验收。
- ADR Coverage 审阅完成：决定、链接、accepted 状态与最终实现一致；工作树 host 根扩展由 ADR-0045 定义、ADR-0037 已链接承接。查看 [spec ADR Coverage](../spec.md#adr-coverage)。最终合同审阅与文档/tracker 命令记录：`/tmp/rukie-session-workspaces-evidence/delivery-verification.md`。
