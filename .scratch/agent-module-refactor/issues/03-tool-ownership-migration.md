Status: resolved
Blocked by: [02](02-tool-runtime-and-factories.md)

# 03：Bash、Web Fetch、Todo、Jobs 与 Permission Review 归属迁移

## What to build

把工具及关联能力集中在能力模块，将完整 Jobs registry 与工具包装归同一能力目录，并将 Permission Review 收进权限模块。每个内部消费者和当前文档在本票同步迁移。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

迁移 bash/ 至 tools/bash/，web-fetch/ 与 tools/web-fetch.ts 至 tools/web-fetch/，tools/todo.ts 与 tool-state/todo.ts 至 tools/todo/，完整 jobs/ 至 tools/jobs/（内部区分 registry.ts 与 tools.ts），review/ 至 permissions/review.ts。

## Acceptance Criteria

- [x] Bash 保留同一 jobs.start 进程路径与 pi OutputCapture 约束；仅调整拥有位置和导入，不拆分前后台执行。
- [x] Web Fetch 保留内部地址/HTTP/代理/内容转换分工、匿名请求、DNS pinning、安全拒绝、重定向、总超时、大小限制与取消。
- [x] Todo 工具、schema、类型、状态版本解析和提醒集中；Session 从工具入口注册 todoState，tool-state/index.ts 不再导出具体 Todo 定义。
- [x] 包级 TodoItem 及现有 SessionOptions 的 WebFetchOptions 行为保持兼容，所有内部引用更新。
- [x] tools/jobs/ 同时提供 registry 与工具工厂，内部区分资源、输出和游标管理与 job_output/job_list/job_kill 协议包装；Session 和 Bash 经该能力入口直接消费 registry。
- [x] Permission Review 保留独立模型调用、失败转 ask、取消及权限规则，不改变 locale 或输出约定。
- [ ] ~~更新本票涉及的当前架构/源码链接~~（不可恢复：本票更新了哪些当前文档链接无法归因，`docs/architecture.md` 在本区间的改动只来自票 07；删除旧目录、旧文件和废弃内部转导出，镜像的内部测试路径迁移，以及跨概念 e2e 未为对称而搬动，均有证据，见评论）

## Verification

01 协议基线；Bash、Background Jobs、Job API/Notifications/Subagent Jobs、Web Fetch 全部专项、Todo/Reminders、Permission Review/Rules 与 auto-review 的公开测试。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

列出旧归属删除与所有导入更新证据，保留已有文案和结果断言；记录公开测试、格式、lint、类型与相关文档检查。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
- 2026-10-07：实施完成（`b1d9e97`，集成 `f96cd9d`，父提交 `470d4b9`）。因实施时未追加证据评论，本条由票 08 在集成点 `ba200b7` 逐条复核后补记；所有命令均在票 08 worktree 实际运行。

  搬迁为内容保持型移动，逐文件核对 blob（`git rev-parse 5c730be:<旧> ` 与 `git rev-parse ba200b7:<新>`）：

  | 旧路径                                 | 新路径                                       | blob     |
  | -------------------------------------- | -------------------------------------------- | -------- |
  | `src/bash/index.ts`                    | `src/tools/bash/index.ts`                    | 完全相同 |
  | `src/bash/output-capture.ts`           | `src/tools/bash/output-capture.ts`           | 完全相同 |
  | `src/web-fetch/index.ts`               | `src/tools/web-fetch/fetch.ts`               | 完全相同 |
  | `src/web-fetch/addresses.ts`           | `src/tools/web-fetch/addresses.ts`           | 完全相同 |
  | `src/web-fetch/content.ts`             | `src/tools/web-fetch/content.ts`             | 完全相同 |
  | `src/web-fetch/proxy.ts`               | `src/tools/web-fetch/proxy.ts`               | 完全相同 |
  | `src/web-fetch/html-dependencies.d.ts` | `src/tools/web-fetch/html-dependencies.d.ts` | 完全相同 |
  | `src/review/index.ts`                  | `src/permissions/review.ts`                  | 完全相同 |

  仅有差异的两处：`tools/web-fetch/http.ts` 只改 `import { version } from "../../package.json"` → `"../../../package.json"`；`tools/jobs/registry.ts`（原 `jobs/index.ts`）只删除末尾 `export { createJobTools } from "./tools.ts";`（工厂转导出移入 `tools/jobs/index.ts`），`tools/jobs/tools.ts` 只把 `jobStatus, type Jobs` 的导入从 `./index.ts` 改为 `./registry.ts`。因此 Bash 的 `jobs.start` 进程路径与 pi `OutputCapture` 约束、Web Fetch 的地址/DNS pinning/代理/内容转换/安全拒绝/重定向/大小限制/取消全部是同一份代码。

  入口分工：`tools/jobs/index.ts` 只转导出 `createJobs`、`jobStatus`、`type Jobs`（`registry.ts`）与 `createJobTools`（`tools.ts`）；`tools/bash/index.ts:11` 用 `import type { Jobs } from "../jobs/index.ts"`；`session/index.ts:1` 用 `import { createJobs, jobStatus } from "../tools/jobs/index.ts"`，`:911` 的完成通知仍用 `jobStatus(job)`。Todo：`tools/todo/index.ts` 提供 `createTodoTool` 并转导出 `todoState`、`type TodoItem`；`tools/todo/state.ts` 持有 `todoSchema` 与版本解析/提醒；`tool-state/index.ts` 删除了原有的 `export { todoSchema, todoState, type TodoItem } from "./todo.ts";` 两行，只保留通用 `ToolStateDefinition`/`createToolState`；`session/index.ts:80` 改为 `import { todoState, type TodoItem } from "../tools/todo/index.ts"` 并在 `:432` 注册 `goalState`、在工具状态定义列表注册 `todoState`（子 Session 不注册 goal）。包导出 `packages/agent/src/index.ts:29` 由 `./tool-state/index.ts` 改指 `./tools/todo/index.ts`，导出名 `TodoItem` 不变；`SessionOptions.webFetch?: WebFetchOptions`（`session/index.ts:124`）仍指向 `tools/web-fetch/index.ts`，该能力入口新增了一行 `export type { WebFetchOptions } from "./fetch.ts";` 以提供类型。

  删除清单（`git log --diff-filter=D 5c730be..ba200b7`）：`src/bash/`、`src/web-fetch/`、`src/jobs/`、`src/review/`、`src/tool-state/todo.ts`、`src/tools/todo.ts`、`src/tools/web-fetch.ts` 全部由 `b1d9e97` 删除；首次创建提交为 `tools/{bash,web-fetch,todo,jobs}` = `b1d9e97`、`permissions/review.ts` = `b1d9e97`。仓库内（`.scratch` 之外）无旧路径引用（`git grep -E "src/(bash|web-fetch|jobs|review)/|src/tool-state/todo|src/tools/(todo|web-fetch)\.ts"` 无命中）。

  命令与结果（worktree `agent-module-refactor-08`，`ba200b7`）：
  - `env -u NO_COLOR bun test packages/agent/tests/e2e/bash.test.ts packages/agent/tests/e2e/background-jobs.test.ts packages/agent/tests/e2e/job-api.test.ts packages/agent/tests/e2e/job-notifications.test.ts packages/agent/tests/e2e/subagent-jobs.test.ts packages/agent/tests/e2e/web-fetch.test.ts packages/agent/tests/e2e/web-fetch-html.test.ts packages/agent/tests/e2e/web-fetch-permissions.test.ts packages/agent/tests/e2e/web-fetch-proxy.test.ts packages/agent/tests/e2e/web-fetch-redirects.test.ts packages/agent/tests/e2e/todo.test.ts packages/agent/tests/e2e/todo-reminders.test.ts packages/agent/tests/e2e/reminders.test.ts packages/agent/tests/e2e/permission-review.test.ts packages/agent/tests/permissions/bash-rules.test.ts` → 317 pass / 0 fail，15 文件，1286 expect，exit 0。
  - 其中 `bash escalates cancellation when a process handles SIGTERM without exiting [3026.30ms]` 超过 1 秒：该文件（`bash.test.ts`）在本区间未被修改，等待验证的是 SIGTERM→3 秒→SIGKILL 的真实进程时序契约，虚拟时钟无法覆盖，属必需的实时成本。
  - `packages/agent/tests/e2e/todo-reminders.test.ts` 只有 1 行导入路径改动（`type TodoItem` 来源），断言未改；`permission-review.test.ts` 本区间只有来自 main `3200d15` 的 fake-timer 改造（同一批断言，改为 `jest.advanceTimersByTime(29_999/1)`），非本票改动。

  未能验证/限制：
  - 本票没有留下自己的实施证据评论。`docs/architecture.md` 中 bash/jobs/web-fetch/todo 相关行的更新无法归因到本票：该文件在区间内只被票 07（`340aa1a`）改动，票 05/06 的证据明确把 `architecture.md` 的同步推给票 07。最终状态正确（见票 07、票 08 的文档核对），但"本票更新了哪些当前文档链接"不可恢复。AC 第 7 项因此取消勾选并保留删除线原文：该条的文档子句不可核实，删除与迁移子句有证据。
  - Permission Review 的失败转 ask、取消与显式规则行为由既有 `permission-review.test.ts`（31 项）与 `permissions/` 套件保护，文件 blob 与 `5c730be` 相同；这是既有覆盖，不是本票可独立区分的证据。
  - 未运行 `bun run check` 聚合检查（按 Spec 留给票 08）。
