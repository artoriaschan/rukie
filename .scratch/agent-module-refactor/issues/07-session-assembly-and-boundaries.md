Status: resolved
Blocked by: [06](06-plan-mode-controller.md)

# 07：Session 工具组装整理与导入方向约束

## What to build

在 Session 内部整理已有工具选择、组合与刷新，落实模块边界 lint 和正式工程文档；不改变运行架构。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

packages/agent/src/session/tools.ts、tools/入口、.oxlintrc.json、AGENTS.md、docs/architecture.md 与 ADR-0011 的迁移状态。

## Acceptance Criteria

- [x] 按能力工厂组装，工具组装接受当前能力与查询，不持有另一份 Session 状态或接收全部能力的大工厂。
- [x] 保留启动、Run前、Turn准备的不同刷新范围；基础工具/Plan/Goal先构造再发现子类型，最后加入Subagent、过滤和计量包装。
- [x] 回调缺失、顶层/子身份、子类型、fork继承、当前MCP server映射/继承过滤及动态description保持。
- [x] Hook 独立只读工具构造、MCP连接与协议适配生命周期保持，例外通过具体支持入口消费。
- [x] MCP 快照缓存、revision、probe、管理互斥与资源生命周期继续归 Session/MCP，不抽入 session/tools.ts 或 tools 能力。保留 McpSnapshot、McpToolView、McpConfigError 与 Session MCP 管理公开接口。
- [x] mcpServers({ refresh }) 保留独立副本、缓存读取不重连、刷新完整替换与并发 probe 共享；mcp_servers_changed 在提交后通知且相同快照不重复发送。保留较新 Run 快照优先、单 server 管理保留其他 server、配置诊断/来源/脱敏/原始 schema，以及 dispose 清理且无迟到事件。
- [x] 现有 Oxlint 拒绝能力内部 controller/registry/state 反向导入自身协议适配或全局工具组装入口，以及通用 Tool State 导入具体状态定义；不禁止整个 tools 目录的消费。
- [x] Session 直接使用能力入口，Bash 使用 Jobs registry、恢复模块使用 Subagent 事实、MCP 和 Hook 合法调用均可通过；Agent Core 能力不导入 Frontend 屏幕、组件或命令解析。
- [x] 以受控临时违规输入验证路径和必要导入名称规则，清理输入；不宣称字符串检查能识别完整传递依赖图。
- [x] 审查入口转导出和旧目录残留，更新当前架构职责与扩展规则，移除ADR迁移状态中已不成立的描述。
- [x] 保持根CLAUDE.md相对软链接，不新增领域术语或依赖。

## Verification

01 动态工具协议基线，MCP发现、Hooks模型、子类型/权限/fork过滤、Interaction缺失和相关Session生命周期公开用例；运行lint的违规/合法例外验证、类型与Knip。

MCP 快照与刷新验收复用 packages/agent/tests/e2e/mcp-api.test.ts，授权和配置复用 Spec 列出的现有 MCP 套件；不得仅验证工具发现而遗漏 Session 管理接口。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

记录规则实际命中和合法例外、完整工具刷新对照、删除清单、文档路径和软链接检查。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
- 2026-10-07：实施完成（worktree `agent-module-refactor-07`，基点 a9dbe98）。新增 `packages/agent/src/session/tools.ts`：`createBaseTools`（builtin → plan-mode → goal，按能力工厂构造；接收 `BuiltinToolsOptions`、`PlanModeController`/`OnPlanReview` 与 Goal 的惰性执行 facade）、`createSubagentTools`（顶层四个工具，子 Session 为空数组）、`refreshSubagentTypes`（发现 + `setTypes`，只有 Run 传入 `report` 诊断）、`selectTools`（gate 过滤 + 计量包装）、`createTurnTools`（Turn 前非 MCP + 当前 MCP）；gate 由 Session 以 `allowsTool`/`measureTool` 闭包注入，模块不保存 Session 状态，也不是接收全部能力的大工厂。

  `session/index.ts` 三个组装点保持各自范围与顺序：seed（基础工具 → 子类型发现，不报诊断）、`initialState.tools`（seed + Subagent 工具 → `allowsTool` → `measureTool`）、Run `finally`（`createBaseTools` + `mcp.tools` → 发现并报告 warnings/hook warnings → `mcpToolServers` → 追加 Subagent → 过滤/计量 → `nonMcpTools` → `prepareNextTurnWithContext` 用 `createTurnTools` 重算）。`isChild = Boolean(internal.parentSessionId)` 统一顶层/子身份；`tools/builtin.ts` 的 9 位置参数改为 `BuiltinToolsOptions`，调用点同步（`session/tools.ts` 与 `tests/e2e/session-allow-rules.test.ts` 两处），工具名称、description、parameters 与声明顺序未改。

  入口与删除清单：删除 `packages/agent/src/tools/index.ts`（迁移后无消费者，保留即为绕过能力入口的第二条路径）；`packages/agent/src/index.ts` 的 `Question`/`QuestionRequest`/`QuestionReply` 转导出改指 `tools/question.ts`（包公开导出不变）；测试改从 `tools/builtin.ts` 消费。各能力 `index.ts` 只转导出本目录模块；仓库内已无 `tools/<能力>/<文件>.ts` 深层导入，跨能力只用入口（`tools/bash/index.ts` → `../jobs/index.ts`、`subagents/types.ts` → `../../hooks/index.ts`）。旧顶层目录（bash/web-fetch/goal/jobs/subagents/plan-mode/review 与 `tool-state/todo.ts`）在本票基点已不存在（`ls packages/agent/src`、`git ls-files` 核对）。`McpSnapshot`/`McpToolView`/`McpConfigError`、Session MCP 管理 API 与 `mcp` 模块代码本票未改。

  Oxlint（`.oxlintrc.json`）新增三组 override：Agent Core → Frontend（`@neant/tui`、`@neant/neant-cli`、`@neant/neant-tui`、`**/apps/**`，作用于 `packages/agent/src/**`）；能力执行模块（`tools/*/{controller,registry,state,types,fetch,http,content,proxy,addresses,output-capture}.ts`）→ 自身协议适配（`./tools.ts`、goal 的 `./tool.ts`）或全局组装入口（`../index.ts`、`../../tools/index.ts`）；`tool-state/**` → `**/tools/**`。能力 `index.ts`、适配模块本身、`tools/runtime.ts`、`tools/builtin.ts` 不在限制范围；Session 的 `./tools.ts`（组装模块）与 Session/其他能力导入整个 `tools/` 未被误伤。

  受控违规验证（先放临时输入跑基线，再加规则）：
  - 加规则前：存在 `packages/agent/src/tools/tmp-boundary/{tools,controller,registry,state}.ts`、`packages/agent/src/tool-state/tmp-boundary.ts`、`packages/agent/src/tmp-frontend-boundary.ts` 时 `bunx --no -- oxlint` → `Found 0 warnings and 0 errors.`（exit 0，404 文件），证明这些路径当时不受约束。
  - 加规则后同一批输入 → `Found 0 warnings and 8 errors.`（exit 1，407 文件），逐条命中：`tools/tmp-boundary/controller.ts:1 './tools.ts'`、`:2 '../index.ts'`、`:3 '@neant/tui'`（同一文件同时命中能力与 Frontend 两组；初版把两组放在不同 override 时只命中后者，说明 oxlint 按规则名覆盖而非合并，故特定 override 内已带完整 Frontend 组）、`registry.ts:1 './tools.ts'`、`state.ts:1 '../../tools/index.ts'`、`tool-state/tmp-boundary.ts:1 '../tools/todo/state.ts'`、`tmp-frontend-boundary.ts:1 '@neant/neant-cli'`、`:2 '../../../apps/neant-tui/src/index.ts'`；能力 `tools.ts` 与 `index.ts` 形式的转导出在同一次运行中未被标记。
  - 覆盖上限对照：`tools/tmp-transitive/controller.ts` → `helper.ts` → 自身 `./tools.ts` 的传递路径 → `Found 0 warnings and 0 errors.`，即规则只匹配配置文件里的导入说明符，不校验完整传递依赖图。
  - 清理：`rm -rf` 上述两个临时目录与两个临时文件后 `git status --porcelain` 只余本票真实改动，`find packages -name 'tmp-*'` 无结果；仓库级 `bunx --no -- oxlint` → exit 0（398 文件，0/0）；对合法消费者定向运行（`session/index.ts`、`session/tools.ts`、`tools/{bash,jobs,plan-mode,subagents,goal}/index.ts`、`hooks/model.ts`、`mcp/index.ts`、`tool-state/index.ts`）→ exit 0（10 文件，0/0）。

  文档：`docs/architecture.md` 删除"当前顶层…表中目录尚未全部迁移"句并指向 `session/tools.ts`、`subagents/` 行改为链接 `tools/subagents/index.ts`、工具职责句改为"能力模块构造 + Session 按身份/子类型/MCP 组装"、扩展规则"增加模型工具"指向 `session/tools.ts`（表格列宽由 oxfmt 重排）；`docs/adr/0011-agent-module-ownership.md` 迁移状态改为当前事实（能力位于 `tools/`、同名顶层目录与 `tool-state/todo.ts`、`tools/index.ts` 已删除、`session/tools.ts` 组装、Oxlint 约束及其不覆盖传递依赖的上限），决定本身未改；根 `AGENTS.md` 的 Tools capabilities 条补组装落点，并把"staged migration"改为已落地的 enforced import restrictions；`CONTEXT.md` 无模块路径引用，未改动，未新增术语。核对到的相对链接全部存在：architecture.md 36 条、ADR-0011 4 条、AGENTS.md 12 条（其中 6 条为本票新增）。`ls -l CLAUDE.md` 改动前后均为 `CLAUDE.md -> AGENTS.md` 相对软链接，全程未写入该路径。

  命令与结果（worktree `/Users/artorias_chan/.zcode/worktrees/agent-module-refactor-07/Neant`，基点 a9dbe98）：
  - 改动前基线（同批 18 套件）：`env -u NO_COLOR bun test …` → 299 pass / 0 fail，1222 expect，exit 0。
  - 改动后 19 套件（ticket 列出的 18 个 + `session-allow-rules.test.ts`）：`env -u NO_COLOR bun test …` → 317 pass / 0 fail，1274 expect，19 文件，8.91s，exit 0。
  - `bunx --no -- oxfmt --check` → exit 0（694 文件）；`bunx --no -- oxlint` → exit 0（398 文件，0/0）；`bunx --no -- tsc -b` → exit 0；`bunx --no -- tsc -b --force` → exit 0；`bunx --no -- knip` → exit 0（无输出）。
  - 未运行 `bun run check` 聚合检查（按 Spec 留给票 08）。

  未能验证/限制：
  - MCP 快照缓存/revision/probe/管理互斥与刷新语义、Hook 独立只读工具集本票未改代码，`mcp-api.test.ts`、`mcp-config.test.ts`、`hooks.test.ts`、`model-hooks.test.ts` 全绿且 `session/tools.ts` 不接触相关状态；但这些不变量由既有套件保护，不是本票可独立区分的证据。`prepareNextTurnWithContext` 的 Turn 级 MCP 替换同样只有既有 MCP 套件覆盖，未新增用例。
  - `createBaseTools` 在 Run 前重建 Plan/Goal 工具对象（改动前复用启动时对象）。两者都是对同一 controller 的无状态闭包，公开测试（工具声明、plan-mode、goal-tools、reminders）未区分，也未观察到行为差异。
  - 静态规则只覆盖配置的导入路径与名称：传递依赖（controller → helper → 自身适配）实测不报，`packages/agent/tests/**` 不适用 Frontend 规则（仅 `src/**`），以免限制跨包集成测试。
  - 工具集的"刷新范围与顺序保持"由 `tool-declarations.test.ts` 的模型可见声明基线与 MCP/子类型套件回归保护；本票未新增针对组装函数内部的单元测试（无内部接缝测试接口）。

- 2026-10-07（票 08 复核，集成点 `ba200b7`，worktree `agent-module-refactor-08`）：本票 AC 全部成立，但**发现并修复一处缺陷**——本票声称的 Oxlint"全局工具组装入口"约束在提交时已经指向被同一次提交删除的路径，实际不生效。

  缺陷与修复：`.oxlintrc.json` 的能力执行模块 override 用 `"../index.ts"` 与 `"../../tools/index.ts"` 表示"全局工具组装入口"，两者都解析到 `packages/agent/src/tools/index.ts`，而该文件正是本票 `340aa1a` 删除的；本票删除它之后，真正的全局组装入口变成 `packages/agent/src/tools/builtin.ts`（内置工厂）与 `packages/agent/src/session/tools.ts`（Session 组装），二者都不在限制内。因此 AC"Oxlint 拒绝能力内部 controller/registry/state 反向导入…全局工具组装入口"当时只对"自身协议适配"一半有效，对"全局组装入口"一半是空规则；ADR-0011 迁移状态与 `AGENTS.md` 的同一表述因此不成立。修复（票 08，`.oxlintrc.json`）：在原有 group 中追加 `"../builtin.ts"`、`"../../tools/builtin.ts"`、`"../../session/tools.ts"`，保留原有三个模式（它们仍防止重新引入旧入口）。

  受控验证（先证缺口、再证命中、再证合法例外，最后清理）：
  - 加规则前：临时 `packages/agent/src/tools/tmp-boundary/controller.ts` 同时 `import { createBuiltinTools } from "../builtin.ts"` 与 `import { createBaseTools } from "../../session/tools.ts"` → `bunx --no -- oxlint` = `Found 0 warnings and 0 errors.`，exit 0（400 文件），缺口成立。
  - 加规则后：同一输入 → `Found 0 warnings and 2 errors.`，exit 1，两条命中分别落在 `tmp-boundary/controller.ts:1`（`../builtin.ts`）与 `:2`（`../../session/tools.ts`），消息为本票既有文案。
  - 合法例外：同目录的适配文件 `tmp-boundary/tools.ts`（`import { leaked } from "./controller.ts"` 与 `import { createJobs } from "../jobs/index.ts"`）在同一次运行中未被标记，说明协议适配与跨能力入口消费仍然放行。
  - 清理与回归：`rm -rf` 校验绝对路径后删除临时目录，`git status --porcelain` 只余 ` M .oxlintrc.json`，`find packages -name 'tmp-*'` 无结果；干净树 `bunx --no -- oxlint` = `Found 0 warnings and 0 errors.`（398 文件，exit 0）、`bunx --no -- oxfmt --check` exit 0（694 文件）、`bunx --no -- tsc -b` exit 0、`bunx --no -- knip` exit 0、`git diff --check` exit 0。
  - 规则上限不变：本票已记录"只匹配配置文件里的导入说明符，不校验完整传递依赖图"；票 08 未改变这一点，也未新增任何检查框架或依赖。

  其余 AC 复核：`session/tools.ts` 只导出 `createBaseTools`、`createSubagentTools`、`refreshSubagentTypes`、`selectTools`、`createTurnTools` 与两个输入类型，通过 `ToolGate` 闭包接收 `allowsTool`/`measureTool`，不持有 Session 状态；三个组装点的范围与顺序（seed 不报诊断 → `initialState.tools` 过滤计量 → Run `finally` 重建基础工具 + MCP、发现并报告 warnings/hook warnings、`createTurnTools` 在 Turn 前重算）与 `agent.prepareNextTurnWithContext` 的替换位置由 `tool-declarations.test.ts` 第 ⑨ 项（启动 seed、Run 开始追加 MCP 声明、Turn 准备不重复声明）与第 ⑩ 项（后续 Run 重建动态 `subagent` description）覆盖。`createBaseTools` 在 Run 前重建 Plan/Goal 工具对象这一差异仍按本票原文披露（未观察到行为差异，公开测试不区分）。

  命令与结果（worktree `agent-module-refactor-08`，`ba200b7`，修复后）：
  - `env -u NO_COLOR bun test packages/agent/tests/e2e/tool-declarations.test.ts packages/agent/tests/e2e/mcp-api.test.ts packages/agent/tests/e2e/mcp-config.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts packages/agent/tests/e2e/subagent-mcp-oauth.test.ts packages/agent/tests/e2e/job-api.test.ts packages/agent/tests/e2e/subagent-jobs.test.ts` → 122 pass / 0 fail，8 文件，exit 0。
  - `env -u NO_COLOR bun test packages/agent/tests` → 1390 pass / 0 fail，79 文件，exit 0；`env -u NO_COLOR bun run test:tui` → 956 pass / 0 fail，94 文件，exit 0；`env -u NO_COLOR bun run test:cli` → 127 pass / 0 fail，5 文件，exit 0。
  - 文档：`docs/architecture.md` 的"尚未全部迁移"句已删除、`tools/bash/`、`tools/jobs/`、`tools/subagents/`、`tools/plan-mode/`、`tools/goal/` 行均链接到实际存在的 `index.ts`（票 08 逐条核对相对链接与锚点，0 断链）；`docs/adr/0011-agent-module-ownership.md` 迁移状态与当前事实一致（追加规则后"拒绝…全局组装入口"一句成立）；`CONTEXT.md` 无模块路径引用、未改；`AGENTS.md` Tools capabilities 条与 `session/tools.ts` 落点一致；`ls -l CLAUDE.md` = `CLAUDE.md -> AGENTS.md`（相对软链接，`git ls-files -s` 为 mode `120000`，未被写成普通文件）。

  观察（非缺陷，不作为本票遗留）：`tools/` 自身不再有 `index.ts`，`hooks/model.ts`、`mcp/index.ts`、`session/tools.ts` 与测试直接导入 `tools/builtin.ts`、`tools/runtime.ts`、`tools/question.ts`。这是本票"删除 `tools/index.ts` 以免绕过能力入口"的决定结果；AGENTS.md 的"每个能力暴露 index.ts"针对能力目录，扁平内置工具文件不属于能力目录。未为此新增入口。
