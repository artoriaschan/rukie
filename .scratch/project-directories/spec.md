Status: resolved

# Spec: 多目录 Project、显式信任与 Session Move

## Problem Statement

桌面端的 Project 只有一个路径。用户的一项工作常常跨多个目录，例如主仓库加上文档仓库或依赖源码，目前只能拆成多个 Project，或者在对话里反复粘贴路径。添加 Project 时没有任何信任确认：桌面端从不写入 `trustedProjects`，所以 Project 的项目级 hooks、MCP 配置与 allow 规则永远不生效，用户也无从得知原因。Session 一旦创建就固定在原来的工作目录：在“对话”里开始的工作，后来发现属于某个 Project 时，无法移过去；放错 Project 的 Session 也无法纠正。

## Solution

- Project 绑定一个或多个目录，第一个默认为主目录；hover 目录列表项时显示“设为主要”按钮，点击后该目录成为主目录。主目录是新 Session 的工作目录，其余目录作为附加目录提供给模型。
- 创建 Project 前弹出信任确认框，列出全部目录；确认后 Project 记为已信任，其目录按精确路径进入 Trusted Project 判定。改动前已登记的 Project 视为未信任，首次在其中打开或新建 Session 前先确认。
- 会话菜单新增“移动到项目”：把“对话”或某个 Project 中的 Session 原地改绑到另一个 Project 的主目录，保留 id 与 Transcript，在 Transcript 中记录移动，并在下一次 Run 告知模型工作目录已变化。
- “对话”分类下的 Session 继续共用 `<dataRoot>/workspace`，对话之间不隔离；该目录及应用数据根下的任何目录都不能成为 Project 目录。

## User Stories

1. 作为桌面端用户，我希望创建 Project 时可以选择多个目录，这样一项跨仓库的工作只需要一个 Project。
2. 作为用户，我希望选择的第一个目录默认是主目录，这样单目录 Project 不需要额外操作。
3. 作为用户，我希望 hover 目录列表项时出现“设为主要”按钮，点击后该目录成为主目录，这样可以改变新 Session 的工作目录。
4. 作为用户，我希望新 Session 在主目录中工作，同时模型知道附加目录的路径并遵守它们的 AGENTS.md，这样多个目录的约定都被尊重。
5. 作为用户，我希望切换主目录后，已有 Session 保持原来的工作目录并仍列在该 Project 下，这样切换不会打断或移动已有工作。
6. 作为用户，我希望点击“创建项目”时先看到确认框，列出全部目录并标出主目录，询问是否信任这些文件夹，这样我清楚添加 Project 的后果。
7. 作为用户，我希望确认框说明主目录的项目指令、hooks、MCP 配置和 allow 规则将生效，附加目录的项目指令将被加载，这样我知道信任的具体范围。
8. 作为用户，我希望取消确认时不创建 Project，也不留下任何记录，这样拒绝是彻底的。
9. 作为用户，我希望搜索浮层的“打开文件夹”和侧栏“添加项目”都经过同一个确认，这样没有绕过信任的入口。
10. 作为用户，我希望所选主目录已是某个 Project 的主目录时，直接在该 Project 中打开新会话而不提示，这样重复添加不会产生多余步骤。
11. 作为用户，我希望所选目录与另一个 Project 的目录重叠时被拒绝并提示是哪个 Project，这样每个 Session 只属于一个 Project。
12. 作为用户，我希望嵌套目录（例如 `~/work` 与 `~/work/app`）可以分别成为不同的 Project，并各自确认信任，这样信任不会从上级目录继承。
13. 作为用户，我希望之前添加的 Project 在我首次使用前请求信任确认，拒绝时 Session 照常运行但不加载项目级配置，这样旧 Project 不会静默开始执行 hooks。
14. 作为用户，我希望切换主目录不需要再次确认，这样已授予的信任不被重复询问。
15. 作为用户，我希望会话菜单提供“移动到项目”并列出已登记的 Project，这样可以把“对话”或放错 Project 的 Session 移到正确位置。
16. 作为用户，我希望移动后 Session 保留标题、置顶状态和 Transcript，只出现在目标 Project 下，这样移动不产生副本。
17. 作为用户，我希望移动后模型在下一次 Run 得知工作目录已从旧路径变为新路径，并获得新目录的环境信息，这样它不会继续在旧目录里工作。
18. 作为用户，我希望移动不复制、不删除原目录中的文件，这样我的文件不会被意外改动。
19. 作为用户，我希望执行中或等待确认的 Session 不能移动，这样不会打断正在进行的工作。
20. 作为用户，我希望移动一个未打开的 Session 时不让它继续执行未完成的工作，被其他进程占用时看到“会话被占用”，这样移动没有意外副作用。
21. 作为用户，我希望移动到未信任的 Project 前先确认信任，这样移动不会绕过信任确认。
22. 作为用户，我希望回退到移动之前的检查点时只能回退对话、不能恢复代码，并看到原因，这样回退不会改写旧目录中的文件。
23. 作为用户，我希望不能把应用数据目录或共用的对话目录添加为 Project，这样对话目录永远不会被信任。
24. 作为用户，我希望所有新文案在中文和英文界面都正确显示，这样切换语言后界面完整。
25. 作为键盘用户，我希望目录列表、“设为主要”按钮、确认框与移动菜单都有可见焦点和无障碍名称，这样不用鼠标也能完成全部操作。
26. 作为用户，我希望 Light 与 Dark 主题下新界面符合 DESIGN.md，这样视觉保持一致。

## Implementation Decisions

### 附加目录（Agent Core）

- `createSession` 新增 `additionalDirectories` 选项。Session 仍只有一个 cwd；附加目录不改变工具执行目录、权限路径解析或文件访问范围，因为权限模块不区分 cwd 内外的路径。
- 首次 Run 的环境快照列出附加目录的路径。每个附加目录的 `AGENTS.md` 作为 Project Instructions 加载，按现有 reminder 比对规则在内容变化时重新注入。
- 项目级 `.rukie/settings.json`、hooks、`.mcp.json` 与技能仍只从 cwd 加载，不合并附加目录中的同类配置。
- 附加目录由前端每次打开 Session 时提供，不写入 Transcript；模型可见的指令变化仍由 reminder 记录，满足从 Transcript 重建模型输入的要求。

### Project 登记表

- 桌面端 registry 的 Project 由 `{ id, path, name }` 改为 `{ id, name, directories, primary, trusted }`：`directories` 是有序且非空的绝对真实路径列表，`primary` 是其中之一，`trusted` 是布尔值。旧记录读取时迁移为 `directories: [path]`、`primary: path`、`trusted: false`。`WireProject` 同步更新，UI 的所有 `project.path` 消费方改用 `primary` 或 `directories`。
- 侧栏分组规则改为“Session 的 cwd 等于某个 Project 的任一目录”；没有匹配的 Session 归入“对话”。CONTEXT.md 的 Project 词条同步更新。
- 一个目录只能属于一个 Project。创建时：所选主目录等于某个已有 Project 的主目录时，不创建新 Project，直接在该 Project 中新建 Session；其他任何目录重叠都以 `project_conflict` 拒绝，并返回冲突的 Project 名称。互相嵌套但不相等的目录允许分别属于不同 Project。
- `<dataRoot>` 及其子目录（包括 `workspace/`）不能作为任何 Project 目录，比较使用真实路径，拒绝码为 `project_reserved`。
- Project 名称默认取主目录的 basename，创建后不随主目录切换而改变。
- 本次只提供创建和切换主目录。创建后增删目录、移除 Project 与重命名 Project 不在范围内。

### 信任

- 新增 wire 命令 `project.create { directories, trusted: true }`，替代 `project.add`。UI 在用户确认信任后才发送；服务端拒绝 `trusted` 不为 `true` 的创建请求，保证没有未经确认的创建路径。
- 新增 `project.trust { projectId }`，供改动前登记的未信任 Project 补确认。
- 打开 Session 时，服务端把所有 `trusted` Project 的全部目录并入传给 Agent Core 的 settings 的 `trustedProjects`。数据库中的用户 settings 不保存这份派生名单。Agent Core 的 `isTrustedProject` 保持精确路径匹配，不引入子目录继承。
- 未信任 Project：在其中新建或打开 Session 前，UI 先显示信任确认框；确认后发送 `project.trust`，取消则 Session 照常运行，只是不加载项目级配置。按“所选主目录已存在”直接打开一个未信任 Project 时同样先确认。
- 切换主目录不需要重新确认信任。
- 信任确认框遵循 DESIGN.md 对话框规则：列出全部目录并标出主目录；主目录说明项目指令、hooks、MCP 配置和 allow 规则将生效，附加目录说明项目指令将被加载；确认按钮文案为“信任并创建”（补确认时为“信任”），取消不产生任何记录。

### 切换主目录

- 新增 wire 命令 `project.setPrimary { projectId, directory }`，`directory` 必须属于该 Project。成功后发出 `sessions_changed`（或现有 Project 变更事件）。
- 切换只影响之后新建的 Session。已有 Session 保留原 cwd，打开时以原 cwd 为 cwd，该 Project 的其余目录作为 `additionalDirectories`。
- 目录列表项 hover 或获得焦点时显示“设为主要”按钮；当前主目录显示“主要”标记且不显示该按钮。

### Session Move

- 新增 wire 命令 `session.move { sessionId, projectId }`。目标必须是已登记 Project；Session 的 cwd 改为目标 Project 当前的主目录。只支持从“对话”或一个 Project 移到另一个 Project，不支持移回“对话”；目标主目录等于当前 cwd 时拒绝。
- 准入与 `session.rename`、`session.archive` 一致：执行中或有挂起交互时拒绝；租约被占用时返回 `session_busy`。目标 Project 未信任时，UI 先显示信任确认框，确认后才发送 `session.move`。
- Agent Core 的 store 能力新增移动接口：取得写入租约，在 Transcript 中追加一条 Session Move 记录（旧 cwd、新 cwd），更新会话元数据中的 cwd，然后释放租约。该接口不创建 Session、不调度 Session Resume、不解析模型或凭据。只支持 SQLite 存储；JSONL 存储按 cwd 分目录，不提供移动。
- Session 已在本服务打开且空闲时，服务端先关闭它，再调用移动接口；下次订阅时按新 cwd 打开。
- 下一次 Run 时，Agent Core 从 Transcript 中最新的、尚未告知模型的 Session Move 记录生成一条 system reminder，写明工作目录已从旧路径变为新路径，并补发新目录的环境快照。Session Resume 后仍能从 Transcript 重建同样的输入。
- 原目录中的文件不复制、不删除。永久删除 Session 也不删除任何工作目录中的文件。
- 置顶、归档与标题不变；`sessions_changed` 推送新的 cwd，侧栏据此改变分组。
- 会话菜单的单一操作定义新增“移动到项目”，在右键、行内更多与标题栏三个入口一致出现，子菜单列出除当前所属 Project 以外的已登记 Project。执行中或等待确认时禁用。

### 跨越移动的回退

- `rewind` 选中的 prompt 位于最近一次 Session Move 记录之前时，拒绝恢复代码（返回明确的错误码），只允许回退对话。TUI 的回退选择器在这种情况下禁用“恢复代码”并说明原因。桌面端目前没有回退入口，不受影响。

### 文案与文档

- zh 与 en 同步新增：目录列表、主要、设为主要、信任确认框、信任并创建、信任、移动到项目、目录冲突、保留目录、移动失败与会话被占用等文案；删除 `project.add` 相关的不再使用的键。
- CONTEXT.md 新增 Session Move 词条，更新 Project 词条（多目录、主目录、显式信任、“对话”分类共用 `workspace`）与 Session 词条中“同一个工作目录”的表述。
- 新增 ADR：Session 的 cwd 可以经 Session Move 改绑，移动记录写入 Transcript；Session 可带不改变 cwd 的附加目录。
- docs/hooks.md 与 docs/permission-rules.md 补充：桌面端的 Trusted Project 来自 Project 创建或补确认时的信任确认。
- DESIGN.md 补充 Project 目录列表、“设为主要”行尾操作与信任确认框的规则。

## Testing Decisions

- 测试只验证公开行为，遵循 [docs/testing.md](../../docs/testing.md)。
- Agent Core：通过 `createSession` 与 fake model 验证附加目录出现在首次 Run 的环境快照中、附加目录的 AGENTS.md 被加载且内容变化后重新注入、附加目录中的 hooks 与 MCP 不加载；通过公开 store 接口验证移动写入 Transcript 记录并更新 cwd、租约占用时不改动任何数据、移动后 Session Resume 的下一次 Run 收到移动 reminder 与新环境快照、恢复后再次 Run 不重复该 reminder、回退到移动前的 prompt 时拒绝恢复代码而允许回退对话。
- 服务端 wire 层：`project.create` 的多目录创建、`trusted` 校验、主目录已存在时返回已有 Project、重叠目录 `project_conflict`、`<dataRoot>` 及 `workspace/` 的 `project_reserved`、嵌套目录允许；`project.trust` 与 `project.setPrimary`；`trustedProjects` 只包含已信任 Project 的目录；旧 registry 记录迁移为未信任；`session.move` 的执行中拒绝、`session_busy`、未打开 Session 不产生 Run、已打开 Session 关闭后按新 cwd 重新打开、`sessions_changed` 推送新 cwd。
- UI app 层：Chromium browser 模式下渲染 App，经 fake wire 观察命令与渲染。覆盖多目录选择与默认主目录、hover 与键盘聚焦“设为主要”、信任确认框内容与取消不发送命令、“打开文件夹”同样确认、主目录已存在时直接新建会话、冲突与保留目录错误、未信任 Project 补确认、按任一目录分组、“移动到项目”三个入口一致与禁用状态、移动到未信任 Project 先确认。store 的 Project 新结构解析放在现有 store Node 测试。
- TUI：回退选择器在跨越移动点时禁用“恢复代码”并显示原因。
- 布局：按 DESIGN.md layout preservation gate 记录基线；目录列表与确认框不改变侧栏、标题栏与对话区几何。
- 完成后按 AGENTS.md 进行一次 agent-browser GUI 验收：Light、Dark 与窄宽度截图，检查 cursor、hover、焦点与控制台错误。

## Out of Scope

- 创建后增删 Project 目录、移除 Project、重命名 Project、撤销信任。
- 把 Session 移回“对话”，以及移动时复制或搬迁文件。
- 每个对话独立的工作目录或沙箱。
- Trusted Project 的子目录继承，以及 CLI/TUI 按 git 根目录判定信任。
- 从附加目录合并 hooks、MCP、settings 与技能。
- JSONL 存储（CLI/TUI）的 Session Move。
- 桌面端回退入口。

## ADR Coverage

| 决定或修改                                                                       | 归属                                                                                                                                                                                                              | 理由                                                                                                 |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| SQLite Session Move 原地改绑 cwd、保留身份、以 Transcript 记录移动事实和告知进度 | 新增 [ADR-0040](../../docs/adr/0040-session-move-transcript-boundary.md)；沿用 [ADR-0035](../../docs/adr/0035-desktop-isolated-sqlite-storage.md)                                                                 | store 取得单写者租约并原子写入，不开启 Resume、不解析模型或凭据、不搬动文件；JSONL 拒绝移动          |
| Run 原子告知最新移动及新环境；Conversation Rewind 不撤销移动；跨移动禁止代码恢复 | 新增 [ADR-0040](../../docs/adr/0040-session-move-transcript-boundary.md)，部分替代 [ADR-0017](../../docs/adr/0017-checkpoint-and-branch-rewind.md) 与 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md) | 明确持久化告知进度与代码恢复的安全边界；原生 fork、任务所有权、恢复和备份规则继续有效                |
| 附加目录只贡献环境路径与各自 AGENTS.md，不合并可执行配置                         | 新增 [ADR-0039](../../docs/adr/0039-session-additional-directories.md)；沿用 [ADR-0024](../../docs/adr/0024-adopt-pi-durable-harness.md)                                                                          | Frontend 每次提供目录集合，Session 保留一个 cwd；指令提醒存于 Transcript，Resume 可重建输入          |
| 多目录 Project registry、主目录与信任状态；旧记录为未信任；应用数据根保留        | 新增 [ADR-0041](../../docs/adr/0041-desktop-project-explicit-trust.md)；沿用 [ADR-0035](../../docs/adr/0035-desktop-isolated-sqlite-storage.md)                                                                   | 组织信息保存在应用 SQLite；真实路径精确去重与冲突，嵌套目录可独立登记；切换主目录不移动旧 Session    |
| 显式信任仅派生到打开 Session 的 settings，闲置配置重载不打断 Run                 | 新增 [ADR-0041](../../docs/adr/0041-desktop-project-explicit-trust.md)；沿用 [ADR-0014](../../docs/adr/0014-permission-rules-and-project-trust.md)                                                                | 确认先于创建或目标移动，不写回用户 settings；保留精确匹配，不继承父目录信任，主目录独占可执行配置    |
| 三个会话菜单共用操作定义、目录列表、主目录操作与信任框、zh/en 文案               | 无需 ADR                                                                                                                                                                                                          | 使用既有 UI 分层与安装的 primitives，局部交互与菜单组合由 DESIGN.md 维护；不改变外部持久化或执行合同 |

## Further Notes

- 决策来源：2026-10-13 的设计访谈。共用 `workspace/` 参考 ZCode 的 `~/.zcode/workspace/default`；Codex 桌面端按对话生成目录的方案因位置、命名与信任误判问题未采用；Trusted Project 不采用 Claude Code 的父目录继承。
- 现有 `project.add` 不做兼容，按 AGENTS.md 一次替换所有消费方。

## Delivery Evidence (initial handoff)

- Implementation 01–04, acceptance 05 and all review corrections are integrated on `feat/project-directories`. Every ticket, merger, review and correction task used a fresh subagent; implementers used isolated worktrees.
- Final Standards and Spec delta review has no actionable findings; initial README, canonical legacy ownership, same-Project Move and concurrent canonical creation findings are fixed. ADR Coverage is complete for 0039/0040/0041 and existing storage/trust/Rewind decisions.
- Feature-focused Core, TUI, server, Node and Chromium results and Light/Dark/narrow GUI evidence are recorded per ticket. Final server file 53/53 passed. Full local check remains failed: 3474 pass, 2 TUI failures; one reproduces on main with a click-coordinate mismatch, the other remains unresolved. Release stage was not reached. Desktop package had 188 pass/2 failing consumers, followed by focused repairs passing both; this does not rewrite the package result as all green.
- Implementation and local feature verification are resolved for PR review. CI for the latest PR commit and merge acceptance remain separate; no full local pass, CI pass or merge is claimed. Unresolved broad-run evidence prevents full acceptance claims and is preserved in ticket 05.

- 2026-10-13 follow-up: user explicitly requests repair of both remaining TUI failures and successful local full acceptance plus latest-commit CI. Acceptance reopened; previous run/diagnosis facts remain. Every new diagnosis, implementation, review and integration uses a fresh subagent. Root coordinates verification in `/tmp/rukie-project-directories-evidence/tui-repair/verification.md`; do not rerun the aggregate until causal fixes and focused checks are complete.

## TUI Acceptance Follow-up

- Both remaining TUI failures were causally reproduced with controlled input/frame ordering. Ink now retains the painted press owner and local coordinates across selection repaint, rejecting removed/obscured owners, moved gestures and screen lifecycle changes. Fourteen public renderer cases lock down the behavior; the original Mixed and Folding assertions remain, with controlled renderer deadlines and actual Reporter completion.
- Fresh two-axis review and cleanup-delta review have no remaining findings. The implementation is a local runtime correction under ADR-0013, documented in the renderer README; no new architectural decision is introduced.
- One reviewed local full check passed: Bun3607/0, release included, desktop190/0, total3797/0, exit0 in558.262s. Original failures remain as historical evidence in05. All repair-owned worktrees/fixtures are cleaned.
- Implementation and local full acceptance are resolved before final push. Final delivery still requires all applicable CI checks for the final PR commit to pass; post-push status is recorded in PR checks/description and the delivery reply under the tracker rules. No merge authorization is inferred.
