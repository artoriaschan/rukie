# 05：Git Project 新 Session 的独立工作树

Status: claimed

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

- 2026-10-14：新 implementer 在 `feat/session-workspaces-05`、基线 `dad1e3c9` 实施。公开 seams：server WS/临时 Git 仓库、UI Chromium、store wire envelope；按 spec 的 Testing Decisions 授权。布局修改前既有 layout 6 cases 通过（3.05s），保留 shell/composer 几何，C34 只实现 branch/toggle/hint 子集。原始 query red 与 corrected UI trigger red、strict store red、worktree menu red 留在外部验证记录；最终工单状态由集成验收/审阅负责人关闭。

- 2026-10-14 实现证据：`project.git` 校验顶层/HEAD，Git 参数向量生成独立目录和分支，冲突重试与失败回滚；应用库工作树记录及绑定 `worktreeId`，摘要必填 `worktree` 并严格解析全部 UI 消费者。工作树 Session 排除主目录附加权限，派生 Project 信任、跳过懒同步、拒绝移动；删除 Session/Project 保留记录、目录和分支，host 允许记录路径。
- UI 复用已安装的 Button、DropdownMenu 和 CheckboxItem，满足 C34 当前分支/开关/提示角色，无新增组件或依赖；所有三入口 Move 禁用。同步 en/zh、DESIGN、CONTEXT、server/desktop README。ADR coverage：创建/记录/绑定/信任/生命周期遵循 ADR-0045，绑定懒同步沿用 ADR-0043，host 根扩展遵循 ADR-0037；局部 menu/style 无额外架构决定。
- 验证记录：server 公开 WS focused 六案例 6 pass / 0 fail，62 assertions，1.64s（新案例 408.54ms / 430.98ms / 148.01ms）；UI Chromium worktree-create + session-move + layout 20 pass / 0 fail，9.07s；UI Node store + client 20 pass / 0 fail，329ms。格式化 27 files 与 `git diff --check` 通过；后续仅格式及 TypeScript 注解/声明收窄调整，未改变运行逻辑。公开 wire 的 Git 场景用临时仓库；native host 用注入 executor，无真实 OS/keychain 启动。
- 原始失败证据：query missing red，UI corrected missing-trigger red，store malformed-worktree red，worktree Move enabled red；调试中 workspace/send aria 名称和完整 localized error 文案断言错误已更正，原始失败日志保留。所有日志及详细 evidence 位于协调方外部验证目录的 `05-verification.md`。未运行 final aggregate/static、desktop package 或 agent-browser（统一由主代理负责）；保留 claimed，待最终验收与审阅后统一关闭。
