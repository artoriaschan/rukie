Status: resolved

# Spec: 对话独立目录、Project 绑定、访问范围与独立工作树

## Problem Statement

桌面端“对话”分类的 Session 共用 `<dataRoot>/workspace/`，对话之间的文件互相可见，删除对话后文件无人认领。Session 的 Project 归属由 cwd 现算：切换主目录后旧 Session 留在旧目录，删减目录或移除 Project 后 Session 带着项目目录落入“对话”。“移到项目”只能换到另一个 Project，不能移出，也不能就地选一个文件夹。文件工具的权限默认值只看工具名，cwd 与附加目录不构成读写范围。同一 Project 的并行 Session 共用主目录，没有隔离的 Git 工作树。

## Solution

- 每个新对话拥有 `<dataRoot>/workspace/<id>/`，删除对话时一并删除（[ADR-0042](../../docs/adr/0042-conversation-owned-workspace.md)）。
- Session 持久绑定 Project，cwd 跟随主目录；移除 Project 删除其全部 Session，项目文件保留（[ADR-0043](../../docs/adr/0043-session-project-binding.md)）。
- “移到项目”支持换项目、移出项目、“选择文件夹…”新建并移入。
- Session 访问范围收紧文件工具：范围内读写放行，范围外询问（[ADR-0044](../../docs/adr/0044-session-access-scope.md)）。
- Git Project 的新 Session 可选独立工作树；设置 → 环境 → 工作树列出并删除工作树（[ADR-0045](../../docs/adr/0045-git-worktree-sessions.md)）。

## User Stories

1. 作为用户，我希望每个新对话有自己的工作目录，这样不同对话写出的文件互不干扰。
2. 作为用户，我希望删除对话时看到其工作目录也会被删除，并在确认后一并清理，这样不留垃圾文件。
3. 作为用户，我希望删除项目中的会话不会删除任何项目文件。
4. 作为用户，我希望项目会话属于项目而不是某个目录，切换主目录后会话在下次使用时转到新主目录，AI 被告知目录变化。
5. 作为用户，我希望编辑项目目录不会让会话丢失归属。
6. 作为用户，我希望移除项目时确认框写明“确定删除该项目及其全部对话？项目目录中的文件不会被删除。”，确认后项目与其全部会话（含置顶与归档）被删除。
7. 作为用户，我希望项目中有会话执行中或等待确认时不能移除项目。
8. 作为用户，我希望“移到项目”可以把会话换到另一个项目、移出项目，或“选择文件夹…”新建项目并移入。
9. 作为用户，我希望移出项目的会话得到一个新的空对话目录，项目文件不被复制。
10. 作为用户，我希望“选择文件夹…”选择已有项目的主文件夹时直接移入，选择被其他项目占用的文件夹时看到冲突提示，选择新文件夹时先确认信任再新建并移入。
11. 作为用户，我希望 AI 只能在会话的工作目录与附加文件夹内自由读写，读写其他位置时先询问我。
12. 作为用户，我希望询问时可以选择“本 session 允许此目录”。
13. 作为用户，我希望技能自带的引用文件与命令完整输出不需要额外确认即可读取。
14. 作为 Headless CLI 用户，我希望范围外的文件访问可以通过 `--allow-tools` 或 `full-access` 明确授权。
15. 作为用户，我希望新建 Git 项目会话时可以打开“使用独立工作树”，看到源分支提示，会话在从当前分支派生的隔离目录中工作。
16. 作为用户，我希望创建工作树失败时会话不被创建，选择保留并看到原因。
17. 作为用户，我希望工作树会话不能移到其他项目，“移到项目”置灰。
18. 作为用户，我希望删除工作树会话时工作树保留。
19. 作为用户，我希望在设置 → 环境 → 工作树中看到 rukie 创建且仍存在的工作树，每行显示分支、仓库名、路径与删除按钮，并可刷新。
20. 作为用户，我希望删除工作树前看到“将删除 <路径>（含未提交改动），分支 <分支> 保留；绑定它的会话会回到主项目目录。”，确认后绑定会话回到主项目目录。
21. 作为用户，我希望绑定会话执行中时不能删除工作树。
22. 作为用户，我希望所有新文案在中英文界面都正确，新界面在 Light/Dark 下符合 DESIGN.md，并支持键盘、可见焦点与无障碍名称。

## Implementation Decisions

### 对话目录（工单 01）

- `session.create { project: null }`：server 生成 `crypto.randomUUID()` 目录名，`mkdir` `<dataRoot>/workspace/<id>/` 后作为 cwd 调用 Agent Core；打开失败删除该空目录。
- `session.delete`：Core `deleteSession` 成功后，若 cwd 真实路径是 `workspace/` 的直接子目录，递归删除；校验不越界、无符号链接，失败只 warning。
- 删除确认框对 `projectId === null` 的会话增加“对话的工作目录也会被删除”说明，项目会话文案不变；不新增 wire 字段。
- 不迁移 cwd 为 `workspace/` 根的旧 Session。

### Project 绑定（工单 02）

- 应用数据根的 `app.sqlite` 新增 Session 绑定表 `{ sessionId, projectId, worktreeId? }`，由 `localDatabase` 持有；`summaries()` 的 `projectId` 读取绑定，删除 `projectForCwd` 与基于目录身份的归属计算。
- `session.create` 选择 Project 时写入绑定；`session.move` 更新绑定；`session.delete` 删除绑定。
- 懒同步：`open()` 执行打开前，若绑定 Project 存在、无 `worktreeId`、cwd 不等于当前主目录，先调用 Core `moveSession` 改到主目录。只读 `session.subscribe` 不触发。
- 附加目录与 `trustedProjects` 派生改为按绑定 Project 计算。
- `project.update` 不再检查 Session 归属；删减目录或切换主目录不改变绑定。
- `project.remove`：准入检查所有绑定 Session 的忙碌状态；逐个执行 `session.delete` 的同一路径（含目录、置顶、归档清理），全部成功后移除登记。
- 移除确认框说明替换为“确定删除该项目及其全部对话？项目目录中的文件不会被删除。”（en：“Delete this project and all of its chats? Files in the project directories will not be deleted.”），删除按钮为 destructive，取消保持初始焦点；rukie.pen 同步。

### 移到项目（工单 03）

- `session.move` 的 `projectId` 改为 `string | null`。`null` 表示移出：server 创建新的 `workspace/<id>/` 作为目标 cwd，删除绑定。已在“对话”时拒绝移出。
- 菜单：除当前 Project 外的已登记 Project、“移出项目”（仅项目会话）、分隔线、“选择文件夹…”。三个入口（右键、行内更多、标题栏）共用 `sessionActions`。
- “选择文件夹…”：经 host 选择单个目录；UI 调用现有 `project.create` 流程（信任确认在前），返回已有 Project（主目录相同）则直接移入，`project_conflict` 显示冲突，新建成功后发送 `session.move`。移动失败时已建项目保留。
- 绑定工作树的 Session 整项禁用（工单 05 引入字段后生效）。

### Session 访问范围（工单 04）

- Agent Core 权限模块计算范围：cwd、`additionalDirectories`（读写）；已发现技能根目录、本 Session Job 输出目录（只读）。模式默认值按 [ADR-0044](../../docs/adr/0044-session-access-scope.md) 的表格；规则、hooks 与 review 阶段不变。
- 子 Session 使用父 Session 的范围。Headless CLI 无回调时范围外拒绝。
- 更新 docs/permission-rules.md、Agent README 与 Headless CLI 帮助/文档中依赖“读取全局放行”的描述；TUI 审批文案沿用现有目录授权。

### 独立工作树（工单 05）

- 新 wire 查询 `project.git { projectId }` 返回 `{ repository: boolean, branch: string | null, head: string }`，主目录不是仓库顶层或 Git 不可用时 `repository: false`。
- `session.create` 新增 `worktree?: boolean`，仅对 Project 有效；server 按 [ADR-0045](../../docs/adr/0045-git-worktree-sessions.md) 创建工作树、写入工作树记录与绑定 `worktreeId`，再以工作树目录为 cwd 打开。失败返回 `worktree_failed`（携带 git 输出摘要），不创建 Session。
- 打开工作树 Session：附加目录为 Project 除主目录外的目录；Project 已信任时工作树目录并入 `trustedProjects`；跳过懒同步。
- Session 摘要新增 `worktree: { id, branch } | null`；`sessionActions` 据此禁用“移到项目”；server 拒绝对其 `session.move`。
- 新聊天界面：选择 Project 后显示当前分支与“使用独立工作树”开关（C34 的子集），开启后显示“下一个新会话将从 <分支> 创建独立工作树，不影响主目录。”；不做切换与新建分支。
- 删除工作树 Session 与移除 Project 不删除工作树。sidecar 显示与终端的允许根增加已记录的工作树目录。

### 工作树设置（工单 06）

- 新 wire：`worktrees.list`、`worktree.delete { worktreeId }`、`worktrees.refresh`。
- 设置导航“环境 → 工作树”启用；页面按 rukie.pen“设置 12 · 工作树”：标题“工作树”，分区“独立工作树”+ 说明“会话使用的独立 git 工作树目录。删除会连同目录内未提交的改动一起清除（派生分支保留在仓库中），绑定它的会话将回到主项目目录。”+“刷新”；列表行：分支图标、分支名、仓库目录名标签、路径、“删除”。空列表显示空状态。
- 删除弹窗“删除独立工作树”：“将删除 <路径>（含未提交改动），分支 <分支> 保留；绑定它的会话会回到主项目目录。”，按钮“取消”“删除”（destructive）。绑定 Session 忙碌返回 `session_busy` 并在弹窗内显示。
- 删除成功：`git worktree remove --force`，删除记录，清除绑定 `worktreeId`，对绑定 Session 执行 Session Move 到主目录（Project 已移除时无绑定 Session）。
- 刷新：移除目录不存在的记录，对存在的源仓库 `git worktree prune`，清除受影响绑定的 `worktreeId`。
- 不做根目录、fetch、自动删除设置与 tab。

### 文档

- CONTEXT.md：更新 Project、Session 词条（绑定、主目录同步、移除删除 Session、对话独占目录），新增 Session 访问范围与独立工作树词条。
- server、desktop、agent README，docs/permission-rules.md，DESIGN.md（工作树列表行与删除弹窗）随对应工单更新。

## Testing Decisions

- 遵循 [docs/testing.md](../../docs/testing.md)，测试公开行为；每个工单在 Comments 维护验证记录。
- server：真实 WS/SQLite 覆盖对话目录创建与删除、open 失败清理、越界与符号链接拒绝；绑定写入、懒同步移动与只读订阅不移动；`project.remove` 级联删除与忙碌拒绝；移出项目与移入；工作树创建、失败不建 Session、移动拒绝、删除与刷新。Git 场景使用临时仓库。
- Agent Core：`createSession` + fake model 覆盖范围内外 `read`/`write`/`glob`/`grep` 在三种模式下的默认值、技能根与 Job 输出只读、规则优先、目录级临时授权、子 Session 共享、Headless 无回调拒绝。
- UI：Chromium browser 覆盖删除与移除确认文案、移到项目三入口与新菜单项、选择文件夹流程、工作树开关与提示、移动禁用、工作树设置页列表、刷新、删除弹窗与忙碌错误；layout preservation gate 记录基线。
- 完成后按 AGENTS.md 进行一次 agent-browser GUI 验收（Light/Dark/窄宽度）。

## Out of Scope

- 迁移既有 Session 或补写绑定。
- 移入 Project 后清理旧对话目录。
- 分支切换、新建分支，工作树根目录、创建前 fetch、自动删除与快照、“在此工作树中新建聊天”、设置页 tab。
- 已有 Session 中途进入或退出工作树。
- 操作系统级 sandbox，`bash`/MCP 的路径范围。

## ADR Coverage

| 决定或修改                                                        | 归属                                                                                                                                                                                                                 | 理由                                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 对话独占 `workspace/<id>`，删除对话删除目录，移入保留旧目录       | 新增 [ADR-0042](../../docs/adr/0042-conversation-owned-workspace.md)，部分替代 [ADR-0041](../../docs/adr/0041-desktop-project-explicit-trust.md)                                                                     | 改变应用文件生命周期与删除语义；canonical workspace 及祖先身份检查落实安全删除边界                    |
| Session 持久绑定 Project，懒同步主目录，移除 Project 删除 Session | 新增 [ADR-0043](../../docs/adr/0043-session-project-binding.md)，部分替代 ADR-0041；沿用 [ADR-0040](../../docs/adr/0040-session-move-transcript-boundary.md)                                                         | 改变归属来源与 Project 移除语义；Project 变更串行化，目录变更经既有 Session Move 与实际写者租约       |
| Session 访问范围决定文件工具的模式默认值                          | 新增 [ADR-0044](../../docs/adr/0044-session-access-scope.md)，部分替代 [ADR-0039](../../docs/adr/0039-session-additional-directories.md)；沿用 [ADR-0014](../../docs/adr/0014-permission-rules-and-project-trust.md) | 改变授权默认值，规则阶段不变                                                                          |
| 独立工作树的创建、记录、信任、删除与刷新                          | 新增 [ADR-0045](../../docs/adr/0045-git-worktree-sessions.md)；沿用 [ADR-0037](../../docs/adr/0037-browser-host-sidecar-capabilities.md)，由 ADR-0045 扩展允许根                                                     | 工作树记录由应用库持有，Git 参数向量创建/删除；ADR-0045 定义允许根扩展，ADR-0037 已通过链接承接该扩展 |
| 移到项目菜单、选择文件夹流程、确认文案、工作树设置页 UI           | 无需 ADR                                                                                                                                                                                                             | 局部交互与文案，由 DESIGN.md 与 rukie.pen 维护，不改变持久化或执行合同                                |

## Further Notes

- 决策来源：2026-10-14 设计访谈（对照程小帮的会话目录与工作树实现）。
- 依赖顺序：01 → 02 → {03, 05}；04 独立；05 → 06。03 的工作树禁用在 05 合入后生效。

## Comments

- 2026-10-15 最终交付：六个实施工单与本 spec 在同一变更关闭。独立目录与安全删除、Project 持久绑定与级联删除、三入口移动/选目录、Session 文件工具访问范围、Git 工作树创建与设置管理均已完成，受影响使用文档同步。每次实施、合并、评审修正和验收任务均使用新的代理。
- ADR Coverage 最终审阅：对照 Implementation Decisions、六工单与最终 diff，0042–0045 的 accepted 决定覆盖应用目录生命周期、持久化绑定/懒同步、授权默认值与 Git 工作树资源。沿用 0040 Session Move、0014 授权/信任与 0037 host 边界；0037 已链接 0045 的工作树允许根扩展，修正表中不准确的更新要求。Project 串行队列、实际 Core 写者租约、删除中断恢复和 canonical workspace 祖先保护落实原决定，没有新增未确认的架构取舍。局部菜单/文案/弹窗尺寸颜色由 DESIGN 与 Pencil 维护，无需新增 ADR。
- Standards / Spec 三个 P1 均修正，公开 Core 7 / 0、server 生命周期 21 / 0 与绑定存储失败增量 1 / 0；新 targeted reviewer 确认没有剩余 actionable finding。文档审阅修复 UI README 与 DESIGN C31 的旧归属/保留对话说明，并明确附加目录访问范围；见 `/tmp/rukie-session-workspaces-evidence/delivery-verification.md`。
- 本地结果按原始与增量证据报告：Bun 514 / 0、Agent e2e 1470 / 0，coding-agent 原全量 1528 / 16；全部 16 例在 fixture 修正后由 focused 212 / 1 + 最后一例 1 / 0 覆盖。Release 113 / 0；Desktop Node 70 通过，Chromium 原包 200 / 5 + 修正五例 5 / 0；弹窗颜色与取消尺寸修正各 2 / 0。全量原失败记录保留，不声称重新全量通过；static 类型/Knip 初始失败经最小修正与对应复验通过，其他本地 static gates 复用有效证据。
- isolated Chromium GUI 原功能/布局/交互验收与最终 `20b6e9aa` 弹窗增量验收通过（Light/Dark、1280/420px、软危险色及 hover、Delete 36px / Cancel 32px、448/388px 弹窗无溢出、初始焦点与 Enter 取消、console/network 检查及进程/临时数据清理）。记录：`gui-verification.md`、`gui-dialog-final.md`。真实 Electron、系统钥匙串与文件夹选择器未视觉验收，授权范围由 wire/Chromium 与 Electron mock 证据覆盖。
- 交付分支 `feat/session-workspaces`，PR #25 待最终推送、CI 与用户 review，尚未合并；resolved 仅表示实现、文档、评审与适用本地验证完成。最终文档/格式/tracker/whitespace 命令与日志见 `delivery-verification.md`，行为/static/GUI 证据按增量复验规则复用。
