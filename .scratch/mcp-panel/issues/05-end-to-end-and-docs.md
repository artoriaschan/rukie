# 05: MCP 面板整体验收与文档

**What to build:** 验证完成接线后的跨概念行为，补齐公开回归与使用说明，交付可审查且状态准确的完整功能。详见 [spec](../spec.md) 的 Testing Decisions。

Blocked by: 04

Status: resolved

- [x] 公开 Core/TUI 组合回归验证实际状态事件、同一 Run 授权/失效与工具浏览更新、Interaction 暂停/恢复、管理结果与选择消失退回，包含相关微任务排序。
- [x] zh/en、40×12、resize、小于下限暂停/恢复、鼠标/键盘/长 schema 与 Todo/Subagent/Goal 共存不溢出，阅读锚点与焦点稳定。
- [x] 主输入锁覆盖普通字符、Enter、历史、Tab 补全、文本/图片粘贴、开启前在途 clipboard/image 结果；OAuth 自定义输入保持可用，关闭后主输入恢复。
- [x] 关闭、Resume、换 Session、取消和退出无面板持久化、Transcript 注入、晚到更新、残留订阅/回调或终端模式。保留 Headless、普通问题、审批与其他 picker 的行为。
- [x] 更新 [MCP 文档](../../../docs/mcp.md)与 [TUI README](../../../apps/neant-tui/README.md)，写明四层导航、输入锁、按键/鼠标、busy、实时快照与回退；公开 Core API/事件契约在其源码 JSDoc 与文档一致。
- [x] 临时 HOME、unset NO_COLOR 下运行完整 `bun run check`，记录实际命令、退出结果、测试数与限制；检查文档格式、引用及diff。
- [x] 提交最终集成 diff、验证记录与固定基线，供集成流程在所有票完成后进行 Standards/Spec 两轴审查；所有票状态与证据符合交付。原 MCP OAuth08真实账户待办保持独立，不能用本票模拟验收关闭。

## Context pointers

- [完整 spec](../spec.md)、[已确认访谈](../interview.md)。
- [question parity tests](../../../apps/neant-tui/tests/e2e/question-panel-parity.test.ts)、[permissions tests](../../../apps/neant-tui/tests/e2e/permissions.test.ts)、[OAuth manual acceptance](../../mcp-oauth/issues/08-tui-mcp-command.md)。

## Comments

2026-10-06：设计已确认，尚未实施。本票补齐跨概念场景而非重复前三层已有断言；仅记录当前运行过的验证，不预填通过证据。

2026-10-06：05 在 `codex/mcp-panel-05` 认领，起点 `e92f713a5bb66ddcad8fb0d0a7b0e2b68592e26c`（tree `0ce1460a111a43e1a522c0f6fd7330809c1e6748`）。对照04实际交付补齐公共跨概念验收和文档；按用户安排不运行 worker aggregate，完整检查待最终集成证据。

2026-10-07：功能验收与文档可交付集成审查，Status 保持 claimed，完整检查与最终 Standards/Spec 两轴审查待 root 最终集成证据，不将 worker focused 当作 aggregate。

- 新增 `mcp-panel-acceptance.test.ts` 五个公开组合：同一 Run 真实 OAuth→工具 reader→scope challenge 清除最后工具→重新授权，缓存事件不额外 tools/list，退回保存的服务器正文 top 与动作焦点；审批→问题→OAuth FIFO 与子代理 origin 问题保留 reader/top；真实 Goal 下一 Run 删除服务器后退回列表并不自动选另一项；失败授权管理的详情结果、回调监听清理与后续输入；打开 reader 退出后终端恢复，公开 Session Store 原始 branch entries 前后完全一致，Resume 不恢复面板且继续输入可用。取消后等待 activity 与运行中提示均消失。
- 04 的43个 MCP 回归以及组件/输入/小终端/持久面板覆盖作为既有实现基线，本票补上述增量，未复制完整基础矩阵。测试由本地协议 fixture、受控模型与隔离 project/home 驱动，没有真实账号或浏览器；原 MCP OAuth08 `ready-for-human` 保持原状。
- 文档更新 `docs/mcp.md`、TUI README 与 Session/API event JSDoc：四层导航、正文/动作焦点、鼠标/键盘、输入锁与挂起粘贴失效、idle retry 与事件缓存读取、busy/结果/FIFO、稳定身份祖先回退、本地状态与 Resume/Transcript 边界。三个修改文档的相对路径和锚点检查均无缺失。
- 当前 related 六文件检查：`rtk proxy env -u NO_COLOR HOME=/tmp/neant-mcp-panel-05-home.0HKkjh bun test apps/neant-tui/tests/e2e/mcp-panel-acceptance.test.ts apps/neant-tui/tests/e2e/mcp-panel.test.ts apps/neant-tui/tests/e2e/mcp-command.test.ts apps/neant-tui/tests/e2e/mcp-auth.test.ts packages/agent/tests/e2e/mcp-api.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts`，95 pass、0 fail、408 assertions、23.07s；日志 `/tmp/neant-mcp-panel-05-focused.log`。随后收紧 idle 谓词并移除冗余 Tool State 键断言，验收单文件重新运行：5 pass、0 fail、57 assertions、1.93s；日志 `/tmp/neant-mcp-panel-05-final-acceptance.log`。下述最终提交还会记录最后的相关检查。
- 当前 `rtk proxy bunx --no -- oxfmt --check`、`oxlint`、`tsc -b`、`knip` 与 `rtk git diff --check` 全部 exit0，日志 `/tmp/neant-mcp-panel-05-{format,lint,types,knip}.log`。本 worker 没有运行 aggregate 或无关广泛测试。
- 首轮红灯来自测试就绪谓词误匹配工具列表简介、精确 UI 文案/焦点假设及 xterm 未 flush 的退出观察；分别以 reader 专用 footer、实际文案/删除身份不自动另选、exit 后 IO flush 修正。没有发现需修改产品行为的缺陷，临时诊断代码均已移除。

- 交付前已 `rtk git merge codex/mcp-panel`：Already up to date，最新集成仍为 `e92f713a5bb66ddcad8fb0d0a7b0e2b68592e26c`，无源码差异。最终修改收紧审批就绪谓词后，验收文件重跑仍为5 pass、0 fail、57 assertions；format/lint/types/Knip全部再次exit0。功能提交以该起点为固定 worker diff，root 最终两轴审查基线仍为 `97b570739d28b5e0ba637aac7fa46ca609cbb16f`。最终 aggregate、审查及票状态收束由root集成完成。

2026-10-07：固定集成 `b0fb6057b6910d2ba6724c1101c28d84f7c52cfd` 的独立审查为 Standards 0 findings、Spec 1个P2。40×12 且真实 Goal、Todo、运行中 Subagent 共存时，MCP 只有5行预算；管理 busy 结果原先优先占用正文外的一行，导致全部操作行和鼠标目标消失。修复在受管理 worktree `mcp-panel-review-fix/Neant`、分支 `codex/mcp-panel-review-fix` 完成，范围限于 owning MCP 组件和相关终端回归。

- 反馈与操作共存但剩余内容不足3行时，反馈使用现有 Divider 的标题槽位；5行保留正文阅读、所选操作、反馈及固定标题/提示，不增加 screen 预算，也不隐藏结果。只有一行内容空间时优先保留操作；足够空间继续使用原独立结果行。未改 Core、screen 的导航、其他持久面板预算或 renderer。
- 扩展公开 `start` 的实际40×12共存用例，确认 busy 后所选 Reconnect、反馈和三个持久预览同时可见，键盘选择及鼠标工具浏览/返回可用，正文/操作焦点和 resize 后继续可用。原实现为0 pass、1 fail、6 assertions，失败精确为缺少 `❯ Reconnect`；修复后1 pass、0 fail、19 assertions。日志 `/tmp/neant-mcp-panel-review-fix-{red,green}.log`。新 worktree 缺少依赖导致的初始模块加载失败已通过 `bun install --frozen-lockfile` 解决，不计为行为红灯。
- 组件终端回归增加实际5行预算及 busy/成功/失败/取消反馈矩阵：正文 reader、所选操作、鼠标 View tools/Back、body/actions 焦点、resize 阅读 top 和实际 flow 高度均有断言。相关五文件 `rtk proxy env -u NO_COLOR bun test apps/neant-tui/tests/components/mcp-panel/mcp-panel.test.tsx apps/neant-tui/tests/e2e/mcp-panel.test.ts apps/neant-tui/tests/e2e/mcp-panel-acceptance.test.ts apps/neant-tui/tests/e2e/mcp-command.test.ts apps/neant-tui/tests/e2e/mcp-auth.test.ts`：76 pass、0 fail、373 assertions、23.20s；测试 helper 隔离 project/home。日志 `/tmp/neant-mcp-panel-review-fix-focused.log`。
- `rtk proxy bunx --no -- oxfmt --check`、`oxlint`、`tsc -b`、`knip` 和 `rtk git diff --check` 全部exit0，静态日志 `/tmp/neant-mcp-panel-review-fix-{format,lint,types,knip}.log`。交付前 `rtk git merge codex/mcp-panel` 为 Already up to date，基线仍为 `b0fb6057b6910d2ba6724c1101c28d84f7c52cfd`。本 worker 未运行 aggregate；原 reviewers 独立复核、修正后集成完整检查和最终状态收束仍待 root，Status 保持 claimed。

2026-10-07：修复已集成到 `codex/mcp-panel` `0b6eeab600cb8b8d0bc41b00d8b30b23b6a30ce4`，tree `8318d87fccefea9db1a81e8e8e4626d81029779e` 与修复 worker 完全相同；集成时工作区干净，touched format 与 diff 检查exit0。最终状态为 resolved。

- 集成完整检查使用 `rtk proxy caffeinate -is env -u NO_COLOR HOME="$neant_mcp_panel_check_home" bun run check`，其中 HOME 由 `rtk proxy mktemp -d` 创建并在退出时清理。实际exit0，2373 pass、0 fail、12238 assertions、170 files、323.78s；format/lint/types/Knip 均通过。完整日志 `/tmp/neant-mcp-panel-integration-check.log`。修正后 focused 通过即集成，原 reviewers 复核与最终 aggregate 在冻结源码上并行执行，遵循用户调整的验证安排。
- 修复前集成 `b0fb605` 全量为2367 pass、1 fail：既有 `session-dispose.test.ts` 的 “dispose cancels a slow in-flight tool hook before running SessionEnd” 超时5002ms。该精确公开用例隔离 HOME 单独复跑1 pass、0 fail、5 assertions、45.61ms；未修改 Core 或增加超时。原失败日志保留为 `/tmp/neant-mcp-panel-integration-pre-repair-check.log`，精确回归日志 `/tmp/neant-mcp-panel-dispose-focused.log`；修正后当前全量没有失败。
- 固定全功能审查基线 `97b570739d28b5e0ba637aac7fa46ca609cbb16f`。Standards 原审查者复核修复 diff，当前0 findings；Spec 原审查者重跑实际共存复现并独立运行两个窄回归，共5 pass、0 fail、75 assertions，原P2已解决，当前0 findings。报告 `/tmp/neant-mcp-panel-standards-review.md` 与 `/tmp/neant-mcp-panel-spec-review.md`。使用文档引用已核对；最终收束仅更新 tracker，产品源码保持完整检查的版本。
- 本票的本地 MCP/OAuth fixture 不替代真实托管账号验收，原 [OAuth08](../../mcp-oauth/issues/08-tui-mcp-command.md) 仍为 ready-for-human。交付在集成分支完成。
- 清理前逐一确认六个实施 worktree（01–05 与 review-fix）工作区干净、HEAD 均为集成分支祖先；ignored 文件仅安装依赖与生成 Husky 文件。已通过 Codex archive_worktree 归档，并由附件列表确认六项均为 archived_worktree；集成 checkout 保留。

2026-10-07：用户要求合并到 main。先将当前 main `7b20c0cd85da489e0971a9a799730f1ee0e94def` 合入集成分支，保留后台任务、JobsPanel 与阅读锚点行为；解决六处冲突并生成合并提交 `1f99e0e`。ScrollBox 同时保留 initialAnchor 和 followOnReachBottom；命令接线同时保留 MCP 四层面板与 `/jobs`，两种界面都不强制阅读区跟随。

- 相关九文件首次回归150 pass、2 fail，精确暴露 main 新版 bash 的必填 description 与旧 MCP 文本报告预期。更新这两处测试契约，增强真实后台任务与 MCP 面板共存验收：JobCard 点击和 `/jobs` 输入不能抢占 MCP 的输入所有权，关闭 MCP 后 JobsPanel 可用，任务完成通知在40×12仍可见。修正后两文件16 pass、0 fail、106 assertions；日志 `/tmp/neant-mcp-panel-main-focused{,-repair}.log`。移除 openJobs 的 MCP guard 时新公开用例0 pass、1 fail，恢复后1 pass、0 fail、13 assertions，日志 `/tmp/neant-mcp-panel-main-focus-{red,green}.log`。
- 冻结合并源码 `1f99e0e` 后，使用临时 HOME、unset NO_COLOR 和 caffeinate 运行完整 `bun run check`，exit0：2477 pass、0 fail、12966 assertions、177 files、388.58s；format/lint/types/Knip全部通过。日志 `/tmp/neant-mcp-panel-main-check.log`。收束记录仅更新 tracker，main 接收与本次检查一致的产品源码。
