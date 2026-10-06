Status: resolved
Blocked by: [07](07-session-assembly-and-boundaries.md)

# 08：最终 Standards/Spec 审查与完整验证

## What to build

对集成后的重构按工程约定与本spec逐项审查，运行最终检查并对齐票状态和证据。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

全部受影响Agent Core、CLI/TUI消费者、文档、lint与本功能工单。发现范围内回归在 owning module 修复，重新运行受影响验证。

## Acceptance Criteria

- [x] Standards审查模块入口、依赖、严格类型、冗余实现、旧内部路径和无用途抽象；Spec审查Q1–Q11与每票验收。
- [x] 验证内置协议、结果/错误细节、事件、动态刷新、Transcript与包公开导出兼容，CLI/TUI消费者保持。
- [x] 对照 182d278 基线与 Spec 的 MCP 验收，复核快照公开类型、刷新/管理/通知/取消契约，以及普通/fork 子 Session OAuth origin、凭据共享和精确工具继承；确认复用了相应公开套件，Frontend 面板状态没有进入 Agent Core。
- [x] 核对Plan Mode和Subagent的并发、存储失败、父子共享、恢复与取消完成边界，以及Bash/Job进程资源清理。
- [x] 运行隔离配置且清除NO_COLOR的完整bun run check，记录实际退出码、通过/失败计数与日志。
- [x] 复查工程规则、架构、ADR迁移状态、源码及文档链接一致，根CLAUDE.md软链接保留。
- [x] 核对顶层 bash/web-fetch/goal/jobs/subagents/plan-mode/review 旧落点、散落的 Plan 工具、tool-state Todo 定义及废弃转导出均已删除；能力内部协议/执行分工和全部消费者没有遗漏。
- [x] 将各票状态与真实完成结果对齐，追加实施和验证证据；未解决检查或范围内问题不能标为resolved。
- [x] 提交、合并、worktree清理由后续执行请求授权范围决定，本票不自行扩大Git操作范围。

## Verification

完整 env -u NO_COLOR bun run check；发现新改动或失败时补跑有必要的公开专项。文档运行 oxfmt --check、链接核对及 git diff --check。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

最终报告改动、公开行为证据、实际检查结果、未解决项和Git状态；没有当前证据不宣称已完成。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
- 2026-10-07：实施完成，**但保持未 resolved**：8 项验收已取得实际证据并勾选；`完整 bun run check` 一项由执行请求明确保留给编排者（集成 worktree `ba200b7` 并行运行），本票不重复运行、也未收到其结果，故该框保持未勾选。命令均在 worktree `/Users/artorias_chan/.zcode/worktrees/agent-module-refactor-08/Neant` 实际运行。

  发现的缺陷（1 项，已修）：`.oxlintrc.json` 中"全局工具组装入口"限制模式指向票 07 同一次提交删除的 `tools/index.ts`，对当前组装入口 `tools/builtin.ts` 与 `session/tools.ts` 不生效；受控临时违规实测加规则前 `Found 0 warnings and 0 errors.`（exit 0），追加三个模式后 `Found 0 warnings and 2 errors.`（exit 1，命中 `tmp-boundary/controller.ts:1` 与 `:2`），同目录适配文件仍放行；临时文件已删除，`git status --porcelain` 只余 `.oxlintrc.json`。完整过程见[票 07 的复核评论](07-session-assembly-and-boundaries.md)。未发现第二处需要修复的范围内缺陷。

  Standards 审查（`git diff 5c730be..ba200b7 -- packages apps docs .oxlintrc.json AGENTS.md`）：
  - 依赖方向：能力目录只有 `index.ts` 对外；`git grep -E "from \"[^\"]*tools/(bash|jobs|todo|goal|web-fetch|subagents|plan-mode)/[a-z-]+\.ts\""` 在能力目录之外零命中。跨能力只用入口：`tools/bash/index.ts:11` → `../jobs/index.ts`（`Jobs` 类型），`tools/subagents/types.ts:11` → `../../hooks/index.ts`。能力 `index.ts` 只转导出本目录模块。
  - 严格类型：`as Static<…>` 断言在 `5c730be` 与 `ba200b7` 均为同样 5 处（`tools/runtime.ts:46,50,62` 与 `tools/subagents/types.ts:79,80`，后者由 `subagents/types.ts` 原样移动），无新增；`as any`、`as unknown as`、`: any`、`@ts-ignore`、`@ts-expect-error` 全仓库 `packages/agent/src` 零命中；非空断言 `!` 与基线同为 11 处同样位置（`file-tracking`、`mcp`、`session`、`tools/bash`、`tools/goal/controller.ts:81`、`tools/subagents/controller.ts:160,241`、`tools/web-fetch/http.ts:13`），全部来自搬迁前的同一代码。
  - 冗余实现/双份来源：`git grep -E "planActive|planEntered|planWrites|planRevision"` 零命中（Session 内联 plan 状态已完全移除）；`running.set|sending.set` 只在 `tools/subagents/controller.ts` 出现（发送队列只有一条）；`tool-state/index.ts` 已不导出具体 Todo/`todoSchema`；工具名等字面量重复均为迁移前既有（`permissions/index.ts` 的规则名列表、`context-usage/index.ts` 的 `subagent` 特判、`session/index.ts:844` 的四个 subagent 工具名过滤，后者在 `5c730be` 第 860 行已存在）。
  - 死代码/旧路径/兼容层：`git grep -iE "deprecated|compat|legacy|shim|backwards"` 在新增行零命中；新增 `TODO|FIXME|XXX|HACK` 零命中；全部删除清单见下；Knip exit 0 无输出（无未使用文件/导出/依赖）。
  - 无用途抽象：逐一检查迁移新增的抽象——`createImageReadEnv`（2 个调用方，用于保持 pi 的 `Result` 子类私有）、`BuiltinToolsOptions`（9 个位置参数改为具名参数对象）、`BaseToolsInput`/`ToolGate`（Session 注入 `allowsTool`/`measureTool` 闭包，避免组装模块持有 Session 状态）、`SubagentDelegationFact`/`SubagentSendFact`/`SubagentListing`/`FORK_TYPE`（Q8 要求的事实接口；`FORK_TYPE` 消除了原文中两处重复的 fork 伪类型），均有 ≥2 处用途或不引入即需复制。唯一单调用点辅助是 `tools/subagents/tools.ts` 的 `sendResult`，它把 `steered` 与 `started` 两个分支的既有结果文本集中一处，未新增行为。
  - lint 是否被削弱：`.oxlintrc.json` 的区间改动为纯新增（没有规则被关闭、降级或放宽 `ignorePatterns`）；`tsconfig*.json`、`package.json` 在本区间无改动（`git diff --name-only 5c730be..ba200b7` 不含它们）。
  - 测试断言未被修改：区间内被改动的测试文件删除行数（不含 diff 头）为 `subagents.test.ts` 0、`plan-mode.test.ts` 2（仅 2 行 import）、`todo-reminders.test.ts` 1（import）、`config/subagent-hooks.test.ts` 1（import）、`session-allow-rules.test.ts` 14（`createBuiltinTools` 位置参数改具名参数的调用点，断言不变）、`notification-hooks.test.ts` 3 与 `permission-review.test.ts` 4（两者均由 main `3200d15 perf(test)` 引入，非本重构）。`a4b16f4` 只删除票 05 新增用例内重复粘贴的 3 行。

  Spec 审查：Q1–Q11 逐条对照——Q1/Q4/Q5/Q7 的落点（tools 能力目录、Web Fetch 整体、Todo 整体且 `tool-state` 不再导出具体定义、`permissions/review.ts`）、Q2/Q6 的有界抽取（Session 只保留协调，plan 状态与子代理运行管理移出）、Q3/Q11 的契约优先（先冻结字面量基线再迁移）、Q8 的事实接口、Q9 的按能力工厂与 Session 组装、Q10 的现有 Oxlint 约束（修复后完整）均成立；Q10 中"不笼统禁止所有模块导入 tools"由票 07 的合法例外验证与本次复核确认。User Stories 1–45 由对应能力的公开套件与冻结基线覆盖；其中 33（每轮刷新与类型描述及时）由 `tool-declarations.test.ts` 第 ⑨⑩ 项直接断言，29（包公开导出兼容）由导出名集合逐一相同证明。

  MCP 验收（对照 `182d278` 的迁移前专项审计）：`McpSnapshot`、`McpToolView`、`McpConfigError` 仍在 `packages/agent/src/index.ts` 导出（导出名集合与 `5c730be` 完全相同）；`packages/agent/src/mcp/` 在本区间只有一行改动（`preserveErrorDetails` 的导入路径），因此刷新/管理/通知/取消契约由 blob 相同的既有套件覆盖：`mcp-api.test.ts`（32 项，含首次探测不改 Transcript、登录/登出/重连、延迟探测让位较新 Run、Run 中拒绝管理、dispose 取消探测与无迟到事件、并发刷新共享一次 probe、单 server 管理不抹其他 server、快照副本隔离与原始 schema）与 `mcp-config.test.ts`、`mcp-oauth.test.ts`、`mcp-oauth-lifecycle.test.ts`。普通/fork 子 Session 的 child origin、授权后真实工具刷新、父子凭据共享、Headless 无授权工具、取消非错误、authenticate-only 精确白名单由 `subagent-mcp-oauth.test.ts` 6 项覆盖（blob `904b5e72…` 与 `5c730be` 相同）；默认类型只继承父已可用 server、显式白名单排除继承 MCP 工具由 `tool-declarations.test.ts` 第 ⑦⑧ 项覆盖。Frontend 面板状态未进入 Agent Core：`git grep -iE "panel|focusedServer|selectedServer|panelState" -- packages/agent/src` 零命中，且 `.oxlintrc.json` 禁止 `packages/agent/src/**` 导入 `@neant/tui`、`@neant/neant-cli`、`@neant/neant-tui`、`**/apps/**`（`git grep -E "from \"(@neant/tui|@neant/neant-cli|@neant/neant-tui)|apps/" -- packages/agent/src` 零命中）；Agent Core 也不导入 `@neant/i18n`。

  Plan Mode / Subagent / Bash-Job 边界：
  - 并发与名额：`tools/subagents/controller.ts` 在 `await` 创建子 Session 之前 `running.set(key, entry)` 预留名额与 AbortController，`if (running.size >= 8) throw new Error("At most 8 subagents can run at once.")`；`subagents.test.ts`「a failed child creation releases its run slot and wakes the waiting parent」与 `subagent-directory.test.ts`「an idle continuation is rejected at eight running children while active steering remains available」通过。
  - 存储失败与回退：`plan-mode.test.ts` 的「a rejected Plan Mode snapshot closes the Run store, rolls back and can be retried」与「pending Plan Mode revisions keep the latest state, report their own failure and stay writable」通过（后者同时覆盖两种 revision 失败顺序）。
  - 父子共享与恢复：`plan-mode.test.ts`「a child continued after a parent rewind reads the projected Plan Mode without its own snapshot」与两处 `test.each(["subagent","subagent_fork"])` 通过；`subagent-outcomes.test.ts`、`subagent-reconciliation.test.ts`、`checkpoint-subagents.test.ts` 全绿。
  - 取消完成边界：`subagents.test.ts`「parent cancellation during child creation settles the late child without a model request」通过；`session-dispose.test.ts`、`job-notifications.test.ts` 全绿。
  - Bash/Job 进程资源清理：`background-jobs.test.ts`、`bash.test.ts`（含 SIGTERM→3 秒→SIGKILL 升级，3026ms，真实进程时序契约）、`job-api.test.ts`、`subagent-jobs.test.ts` 全绿。

  删除审计（`git ls-files` + `git grep`）：
  - `git ls-files packages/agent/src/{bash,web-fetch,goal,jobs,subagents,plan-mode,review}` 七个路径全部为空；`git ls-files packages/agent/src/tool-state` 只剩 `index.ts`；`git ls-files 'packages/agent/src/tools/*.ts'` 只剩 `builtin.ts`、`glob.ts`、`grep.ts`、`path.ts`、`question.ts`、`runtime.ts`、`skill.ts`（`index.ts`、`todo.ts`、`web-fetch.ts`、`plan-review.ts`、`enter-plan-mode.ts` 全不存在）。
  - 删除提交：`b1d9e97` 删除 `bash/`、`web-fetch/`、`jobs/`、`review/`、`tool-state/todo.ts`、`tools/todo.ts`、`tools/web-fetch.ts`；`106062c` 删除 `goal/`；`0c72bf2` 删除 `subagents/`；`bc88d33` 删除 `plan-mode/`、`tools/plan-review.ts`、`tools/enter-plan-mode.ts`；`340aa1a` 删除 `tools/index.ts`。
  - 悬空引用：`git grep -E "(from|import|require)\s*\(?[\"'][^\"']*(\.\./)+(bash|web-fetch|goal|jobs|subagents|plan-mode|review)/"` 在 `packages apps docs AGENTS.md CONTEXT.md` 零命中；`git grep -E "tools/index\.ts|tools/todo\.ts|tools/plan-review\.ts|tools/enter-plan-mode\.ts|tool-state/todo\.ts|tools/web-fetch\.ts"` 只命中 `.oxlintrc.json` 的限制模式（有意保留以防旧入口回归）与 ADR-0011 的迁移状态说明（描述删除事实）；仓库级（排除 `.scratch`）旧路径扫描只命中 `tools/bash/index.ts:11` 的 `../jobs/index.ts`，那是新能力入口。
  - 新布局完整、消费者全部使用能力入口：能力目录 `tools/{bash,jobs,todo,goal,web-fetch,subagents,plan-mode}/index.ts` 齐备；`tools/` 之外引用 `tools/` 的只有 `hooks/model.ts` → `tools/builtin.ts`、`mcp/index.ts` → `tools/runtime.ts`、`session/index.ts` → 五个能力入口 + `tools/question.ts`、`session/tools.ts` → `tools/builtin.ts` + 三个能力入口、`packages/agent/src/index.ts` → 四个能力入口 + `tools/question.ts`、`session-resume/index.ts` → `tools/subagents/index.ts`，以及测试的对应路径。
  - 能力内部协议/执行分工：`index.ts` 只转导出；适配模块 `tools/*/tools.ts`（goal 为 `tool.ts`）持有 name/label/description/parameters/结果包装；执行模块 `controller.ts`/`registry.ts`/`state.ts` 持有状态、并发与资源；`tools/bash/index.ts` 与 `tools/web-fetch/index.ts` 按票 03 要求保持单一文件，未强行拆分。

  文档与链接：`docs/architecture.md`、`docs/adr/0011-agent-module-ownership.md`、`AGENTS.md`、`CONTEXT.md`、`packages/agent/README.md`、`docs/AGENTS.md`、`docs/{mcp,hooks,permission-rules,tech-stack}.md`、`docs/adr/{0009,0010}` 以及 `.scratch/agent-module-refactor/**` 共 25 个文件逐条核对相对链接与锚点 → 0 断链、0 失效锚点（脚本化检查，含标题 slug）。ADR-0011 迁移状态描述与当前事实一致（能力在 `tools/`、同名顶层目录与 `tool-state/todo.ts`、`tools/index.ts` 已删除、`session/tools.ts` 组装、Oxlint 约束及其不覆盖传递依赖的上限）；修复后"拒绝能力执行模块导入自身协议适配或全局组装入口"一句成立。`ls -l CLAUDE.md` = `CLAUDE.md -> AGENTS.md`（相对软链接，9 字节目标），`git ls-files -s CLAUDE.md` = `120000 47dc3e3d…`，未被替换为普通文件。`bunx --no -- oxfmt --check` exit 0（694 文件）、`git diff --check` exit 0。

  命令与结果（worktree `agent-module-refactor-08`；修复后的 `ba200b7` 工作树状态）：
  - `env -u NO_COLOR bun run test:agent` → 1390 pass / 0 fail，6046 expect，79 文件，exit 0。
  - `env -u NO_COLOR bun run test:tui` → 956 pass / 0 fail，7208 expect，94 文件，exit 0。
  - `env -u NO_COLOR bun run test:cli` → 127 pass / 0 fail，634 expect，5 文件，exit 0。
  - `env -u NO_COLOR bun test packages/i18n/tests` → 24 pass / 0 fail，exit 0（该根目录不在三个 `test:*` 脚本内，但属于根 `bun test --parallel=4` 的发现范围；`git ls-files '*test.ts' '*test.tsx'` 显示其余测试文件都在三个脚本覆盖的根目录内）。
  - `env -u NO_COLOR bun test` 8 个协议/MCP/Job 套件 → 122 pass / 0 fail，exit 0；Bash/Jobs/Web Fetch/Todo/Review 15 套件 → 317 pass / 0 fail，1286 expect，exit 0；Subagent 相关 14 套件（`subagents`、`subagent-fork`、`subagent-types`、`subagent-permissions`、`subagent-outcomes`、`subagent-reconciliation`、`subagent-jobs`、`subagent-hooks`、`subagent-directory`、`subagent-mcp-oauth`、`checkpoint-subagents`、`job-api`、`tool-declarations`、`config/subagent-hooks`）→ 152 pass / 0 fail，966 expect，14 文件，exit 0（与票 05 记录的同一组数字一致）；Goal/Plan Mode/权限相关 9 套件 → 157 pass / 0 fail，738 expect，exit 0；Plan Mode 单文件 → 18 pass / 0 fail，exit 0。
  - `bunx --no -- oxfmt --check` exit 0（694 文件）；`bunx --no -- oxlint` exit 0（398 文件，0 warning / 0 error）；`bunx --no -- tsc -b` exit 0；`bunx --no -- knip` exit 0（无输出）；`git diff --check` exit 0。
  - 未运行 `env -u NO_COLOR bun run check`：见未解决项。

  契约兼容的独立证据：
  - 内置工具声明：`packages/agent/tests/e2e/tool-declarations.test.ts` 的 blob 为 `7e7ccb33304a805385ab4848ca128489b4fc917d`。注意该文件在 `5c730be` **不存在**（票 01 创建，父提交 `5c730be`），因此正确表述是"由票 01 `8a6d5b7` 在未迁移树上创建后从未被修改"：`git rev-parse <commit>:…` 在 `8a6d5b7`、`b8a1212`、`470d4b9`、`f96cd9d`、`0c5dc22`、`619e797`、`33383f3`、`0c72bf2`、`bc88d33`、`340aa1a`、`ba200b7` 全部返回同一 blob；实跑 10 pass / 0 fail。
  - 包公开导出：`packages/agent/src/index.ts` 的导出**名称**集合在 `5c730be` 与 `ba200b7` 逐一相同（脚本比对 `diff` 为空）；只有 5 行来源路径改变：`TodoItem` → `./tools/todo/index.ts`、`PlanReviewRequest`/`PlanReviewResult` → `./tools/plan-mode/index.ts`、`Question`/`QuestionRequest`/`QuestionReply` → `./tools/question.ts`、`SubagentIdentity`/`SubagentRun` → `./tools/subagents/index.ts`、`GoalView` → `./tools/goal/index.ts`。`Session` 接口与 `SessionOptions` 无任何公开行改动。
  - 结果/错误细节与 Transcript：`tools.test.ts:377` 断言 `{ code: "ripgrep-unavailable", params: { cause: … } }` 同时出现在工具结果与 `session.messages`，并断言模型上下文不含汉字（locale 无关）。
  - 事件与动态刷新：`tool-declarations.test.ts` 的 `deltas()` 直接断言 system 消息 `toolsAdded`/`toolsRemoved` 的提交顺序（启动 seed → Run 开始追加 MCP → Turn 准备不重复；后续 Run 只重建 `subagent` 声明）。
  - CLI/TUI 消费者：`test:cli` 127/0 与 `test:tui` 956/0 全绿，含 Plan Mode、jobs panel、subagent card、rewind、MCP panel/auth 等消费者套件。

  未解决项（当时的唯一原因，已由下一条评论关闭）：`env -u NO_COLOR bun run check` 由执行请求保留给编排者在 `ba200b7` 并行运行，本票未运行、也未收到结果，故 AC 第 5 项保持未勾选。注意本票为修复 Oxlint 缺陷改动了 `.oxlintrc.json`，因此 `ba200b7` 上的聚合结果不再覆盖最终提交；追加该证据时必须针对最终提交重跑（或由本票在收到指示后运行），并在本评论后追加实际退出码、通过/失败计数与日志。已在本票内针对该改动重跑全部静态检查与受影响套件（见上），但这不是同一次聚合运行。

  其他未能验证/限制：
  - **Hook 只读工具集只是独立工厂（由[票 02](02-tool-runtime-and-factories.md) AC-3 升级记录）**：`hooks/model.ts` 只导入 `tools/builtin.ts`，不加载当时的组装入口 `tools/index.ts`，也不加载今天的 `session/tools.ts`；但该文件同时是内置工具工厂模块，因此模型 Hook 路径仍传递加载 `bash`、`jobs`、`todo`、`web-fetch`、`question`、`skill`。spec 的"Hook 可消费独立只读工具集"（Implementation Decisions）只在"独立工厂 `createReadonlyTools`"层面成立，未实现为独立模块；`tools/builtin.ts` 因此同时服务 Session 组装与 Hook 只读工具集（Divergent Change 倾向），本次评审不重构，仅记录。
  - 预迁移审计的"654 次断言"不可复现为稳定计数：同一组 7 个 MCP/Job 套件连续运行得到 654/656/657/658 次 `expect()`（含时序条件断言）。通过/失败与退出码稳定（112/0，exit 0），文件 blob 与 `5c730be` 逐一相同，故以 blob 相同 + 112/0 作为断言未变的证据。
  - 票 05 的"`subagent-mcp-oauth.test.ts` 4 项"实际为 6 项，已在票 05 更正。
  - 各实施票的变异验证（票 05 的名额释放、票 06 的同值等待与通知队列）未由本票重放：重放需要在生产代码上制造临时变异，超出最终审查票范围；本票只确认相关代码路径与断言存在且通过，并保持各票原有的"未独立区分"披露。
  - 本票未运行 web-fetch 的真实网络专项之外的任何新场景；Web Fetch 的地址/DNS pinning/代理/重定向行为由 blob 与 `5c730be` 相同的既有套件（`web-fetch*` 共 5 个文件）覆盖，不是本票可独立区分的证据。
  - 未验证 worktree 清理（本票不扩大 Git 范围）。

- 2026-10-07：AC 第 5 项完成，本票转 `resolved`。编排者确认本票的 `.oxlintrc.json` 修复正确（独立复现：临时 `tools/zzprobe/controller.ts` 导入 `../builtin.ts` + `../../session/tools.ts` → `Found 0 warnings and 2 errors`，两条命中该两行；`zzprobe/tools.ts`、`zzprobe/index.ts` 不被标记；前端规则与组装入口规则在同一 override 内共存，`@neant/tui` + `../builtin.ts` → 2 errors；探针已删除、无残留），并指示由本票在合并结果上运行聚合检查、自行记录。

  Git 状态：`587457a`（HEAD，`docs(agent): align ticket status and evidence with the delivered refactor`）→ `5f98cd8`（`fix(agent): restrict capability modules from importing the tools entry`）→ `ba200b7`（集成点）。`git merge agent-module-refactor --no-edit` → `Already up to date.`（exit 0）：集成分支尖端 `ba200b7af52b26f9132283b9255737ae66a3d9b9` 已是本分支祖先（`git merge-base --is-ancestor agent-module-refactor HEAD` = YES），因此没有合并提交；合并结果即 HEAD `587457aa3a75cb4792493b82dafe79e73cff5045`，合并后工作树干净（`git status --porcelain` 为空）。未做 worktree 清理。

  聚合检查（在合并结果 `587457a` 上运行，命令与逐步结果来自同一次调用的完整日志）：
  - 命令：`env -u NO_COLOR bun run check`（= `oxfmt --check && oxlint && tsc -b && knip && bun test --parallel=4`）；退出码 **0**。
  - `oxfmt --check`：`All matched files use the correct format.` / `Finished in 682ms on 694 files`（exit 0）。
  - `oxlint`：`Found 0 warnings and 0 errors.` / `Finished in 13ms on 398 files with 98 rules`（exit 0）。
  - `tsc -b`：无输出（exit 0，后续步骤得以继续）。
  - `knip`：无输出（exit 0）。
  - `bun test --parallel=4`：**2497 pass / 0 fail**，14040 expect，179 文件，60.37s，exit 0。
  - 计数与分项运行完全自洽：179 文件 = `test:agent` 79 + `test:tui` 94 + `test:cli` 5 + `packages/i18n/tests` 1；2497 pass = 1390 + 956 + 127 + 24。这同时证明根 `bun test --parallel=4` 的发现范围与三个 `test:*` 脚本加 i18n 的并集一致，没有遗漏测试根目录。
  - 完整日志 5449 行（按仓库惯例 `.scratch/` 只提交 Markdown，故未提交日志文件）；可核对的锚点：第 5–8 行为 oxfmt/oxlint 结果，第 5445–5449 行为 `2497 pass` / `0 fail` / `14040 expect() calls` / `Ran 2497 tests across 179 files. [60.37s]` / `EXIT=0`。

  本票此后的改动仅为 `.scratch/` 下的文档（本评论、各票状态与 spec 状态行）：按根 `AGENTS.md`"仅文档变化时验证格式、引用路径与 diff，不运行测试"执行——对改动的 Markdown 运行 `bunx --no -- oxfmt --check <files>`、`git diff --check`，并重新逐条核对相对链接与锚点。代码、配置与依赖自聚合检查后未再变化。

- 2026-10-07（评审整改：两轴代码审查的 FIX/RECORD 处理，base `e86c0e5`，worktree `agent-module-refactor-review`）：只处理审查结论，公共行为不变，未修改任何既有测试断言。以下命令均在本 worktree 实际运行。

  **FIX 1（已修，配置）**：`.oxlintrc.json` 的能力执行模块限制遗漏共享工具运行时适配层。原 group 覆盖自身协议适配（`./tools.ts`、goal 的 `./tool.ts`）与全局组装入口（`../builtin.ts`、`../../tools/builtin.ts`、`../../session/tools.ts` 等），但 `tools/runtime.ts` 未受限；该模块只做 pi 协议适配（`adaptTool`、`preserveErrorDetails`、`createImageReadEnv`），执行模块导入它会绕过"执行模块不反向依赖协议适配"的方向约定。修复：group 追加 `"../runtime.ts"` 与 `"../../tools/runtime.ts"` 并按三组语义重排数组；message 改为 `A capability execution module must not import its own protocol adapter, the shared tool-runtime adaptation layer, or the global tools entry.`

  受控验证（与票 07/08 同一方法：先证缺口、再证命中、再证合法例外、最后清理）：
  - 加规则前：临时 `packages/agent/src/tools/zzprobe/{controller,tools,index}.ts`（`controller.ts:1` 导入 `../runtime.ts`、`:2` 导入 `../../tools/runtime.ts`；`tools.ts` 导入 `./controller.ts` 与 `../jobs/index.ts`；`index.ts` 转导出两者）→ `bunx --no -- oxlint` = `Found 0 warnings and 0 errors.`（exit 0，401 文件），缺口成立，同一次运行也证明适配文件与能力入口消费本来就不被标记。
  - 加规则后：同一批输入 → `Found 0 warnings and 2 errors.`（exit 1，401 文件），两条命中分别落在 `zzprobe/controller.ts:1`（`../runtime.ts`）与 `:2`（`../../tools/runtime.ts`），`tools.ts` 与 `index.ts` 在同一次运行中未被标记（兄弟适配器与跨能力入口例外仍放行）。
  - 合法例外回归（删除临时文件后整仓运行）：`bunx --no -- oxlint` = `Found 0 warnings and 0 errors.`（exit 0，398 文件），覆盖 `tools/goal/tool.ts`（适配器合法导入 `../runtime.ts`）、`tools/builtin.ts`（导入 `./runtime.ts`）、`mcp/index.ts`（导入 `../tools/runtime.ts`）与全部 `tools/*/tools.ts` 适配器；另对 9 个显式列出的合法消费者定向运行 → 0/0（exit 0）。
  - 清理：校验绝对路径后 `rm -rf` 删除临时目录；`git status --porcelain` 只余本次真实改动，`find packages -name 'tmp-*' -o -name 'zzprobe*'` 无结果。

  文档同步：ADR-0011 迁移状态的枚举补为"自身协议适配、共享工具运行时适配层（`tools/runtime.ts`）或全局组装入口"；根 `AGENTS.md` 只链接该约束、不枚举模式，经核对无需改动。

  **FIX 2（已修，纯重构）**：`tools/plan-mode/controller.ts` 的三处两行投影（初始化、最新 revision 失败回退、`restore()`）收敛为一个 `project(value)` 辅助函数并三处调用；`packages/agent/tests/e2e/plan-mode.test.ts` 零改动（`git diff` 对该文件为空）。

  **FIX 3（已修，纯类型重构）**：`tools/goal/tool.ts` 导出 `GoalToolController`（`Pick<ReturnType<typeof createGoalController>, "view" | "create" | "edit" | "pause" | "resume" | "finish">`）与 `GoalToolExecution`（`{ directHuman(): boolean; goalRound(): boolean; wrapup(text: string): void }`），`createGoalTools` 签名改用两者，`session/tools.ts` 的 `Parameters<typeof createGoalTools>[0]`/`[1]` 改为具名类型；类型经 `tools/goal/index.ts` 能力入口消费（`knip` 认可），运行时无变化。`session/tools.ts` 内 `Parameters<typeof createSubagentCapabilityTools>[0]` 同类写法未在本次审查范围内，保留原样。

  **FIX 4（有意保留，未改代码）**：`session/index.ts:844` 的四个 Subagent 工具名过滤未改为从 `subagentTools` 派生。理由：(1) 派生只在可达状态下等价——子 Session 的 `createSubagentTools` 返回 `[]`，被排除集合在该状态从 4 个名字变为 0 个；子 Session 不暴露 Subagent 工具，`createChild` 因此不可达（`subagents.delegate/fork/send` 只在 `tools/subagents/tools.ts` 命中），等价性依赖可达性论证而非结构。(2) 派生会让 `createChild` 闭包读取同一函数体内更晚声明（第 962 行）的 `const subagentTools`，形成无编译期与测试期保护的 TDZ 顺序耦合。(3) 让能力导出名字清单属于新增能力 API 面，超出整改范围。保留原字面量的行为不变。

  **FIX 5（两项判断，均记录不改代码）**：`tools/subagents/tools.ts` 的 `sendResult` 保留——`steered` 分支返回 `details: {}`，`started` 分支委托 `delegationResult`（details 为 `{agentId, childSessionId}`，文本还依赖 `fact.reused` 在 `delivered to`/`started subagent` 间选择），两分支结果形状本就不同，"合并"只能提取一个 20 字符的文本模板，换来第三个名字并掩盖 fact→result 映射，故不合并。`tools/builtin.ts` 同时服务 Session 组装与 `createReadonlyTools`（Divergent Change 倾向）不重构，与"其他未能验证/限制"新增的 Hook 条目同源，仅记录。

  **RECORD 1（票面更正，未把任何披露升级为"已达成"）**：01 AC-8、02 AC-1、03 AC-7、05 AC-6 取消勾选并保留删除线原文，就地标注"未独立验证"/"由票 07 取代"/"不可恢复"/"不可独立区分"；票 02 AC-3 的 Hook 传递加载限制升级到本票"其他未能验证/限制"与 spec 交付说明；spec 的 Plan Mode 与 Subagent 测试决定各补一句不可独立区分的边界；各票 `Status` 保持 `resolved`，指交付完成、证据边界随框披露，不代表待办。

  **RECORD 2（越界标准问题，只记录不修）**：三处测试文件的 `AGENTS.md` 违背逐条核对来源——
  - `apps/neant-tui/tests/screens/chat/conversation.test.ts`：`for (let run = 0; run < 501; run++)`（第 33 行）所在的「conversation retains the latest 500 TPS samples across real Session Runs」在本 worktree 实跑 **3047.90ms**（1005 expect）。该文件全部行由 `git blame` 指向 main 的 `3200d15 perf(test): reduce waits and add focused development checks`，经 `619e797`（`Merge branch 'main' into agent-module-refactor`，父提交 `0c5dc22` 与 `3200d15`）进入本分支；该提交未记录 `AGENTS.md` "Performance evidence"要求的 before/after 计时。属 main 的既有状态，不在本分支范围。
  - `apps/neant-tui/tests/e2e/clipboard-image-tip.test.ts`（`beforeEach(() => jest.useFakeTimers())` 与本地 `advanceTimers` 包装在第 4–8 行）与 `apps/neant-tui/tests/e2e/status-line.test.ts`（第 164 行内联 `jest.useFakeTimers()`、第 167 行 `advanceTimers`）：两文件的这些行均由 `git blame` 指向 main 的 `3200d15`（文件本身更早，分别由 `34cf2e9`、`692a63c` 创建）；`apps/neant-tui/tests/helpers/clock-app.ts` 的 `startWithClock` 同样由该提交新增，即"未复用 helper"与"helper 存在"同日落地。属 main 的既有状态，不在本分支范围。
  - `packages/agent/tests/e2e/plan-mode.test.ts:573` 的 `await new Promise((resolve) => setTimeout(resolve, 0))`：由本分支票 06 的 `bc88d33` 引入，属本分支代码。判断为**保留**：该等待是 0ms 宏任务屏障，用于在断言"同值调用尚未 settle"这个否定命题前排空任意深度的微任务链，不校验时长契约，也不是等待并发工作完成的固定睡眠；改用 `Promise.withResolvers`/单次微任务 hop 会削弱区分能力。变异证据：同值分支改为返回已 settle 的 promise → 用例在 `expect(repeated).toBe(false)` 失败（`Received: true`）；改为"两次微任务后才 settle"的更深变异 → 0ms 排空仍在同一断言失败，而把排空换成 `await Promise.resolve()` 时该断言通过（只在后续断言暴露）。既有断言未改，临时变异与临时测试改动均已还原（测试文件 `git diff` 为空）。

  行为与静态验证（本 worktree，`env -u NO_COLOR`）：`plan-mode.test.ts`、`goal-tools.test.ts`、`goal.test.ts`、`tool-declarations.test.ts` 合跑 → 68 pass / 0 fail，270 expect，exit 0；`subagents.test.ts`、`mcp-api.test.ts`、`mcp.test.ts`、`hooks.test.ts`、`model-hooks.test.ts` 与上述四套件合跑 → 203 pass / 0 fail，912 expect，9 文件，exit 0；`bunx --no -- tsc -b` exit 0；`bunx --no -- oxlint` exit 0（398 文件，0/0）；`bunx --no -- oxfmt --check` exit 0（694 文件）；`bunx --no -- knip` exit 0；`git diff --check` exit 0。

  聚合检查：`env -u NO_COLOR bun run check`（= `oxfmt --check && oxlint && tsc -b && knip && bun test --parallel=4`），运行于包含本次全部代码/配置改动与该评论之前全部文档改动的状态；退出码 **0**：`oxfmt --check` 694 文件、`oxlint` 398 文件 0/0、`tsc -b`、`knip` 均通过，`bun test --parallel=4` → **2497 pass / 0 fail**，14042 expect，179 文件，60.44s。expect 计数与票 08 前次记录的 14040 差 2，属已披露的时序条件断言波动（见票 01/08 的断言计数说明），通过/失败数与文件数不变。合并与提交后复跑见末条评论。
