Status: resolved
Blocked by: [01](01-public-contract-baseline.md)

# 02：工具适配与基础工厂分离

## What to build

将工具执行适配、错误结果包装和基础/只读工具构造从混合入口分离，保留原公开声明与 pi 运行行为，为后续工具迁移提供稳定构造位置。

执行前读取 [Spec](../spec.md)、[ADR-0011](../../../docs/adr/0011-agent-module-ownership.md) 和根工程约定。依赖票完成且验证通过后才可开始；ready-for-agent 表示信息完备，不表示依赖已解除。

## Scope

packages/agent/src/tools/index.ts 及 tools/runtime.ts、tools/builtin.ts；更新 mcp/index.ts、hooks/model.ts 和所有当前消费者。

## Acceptance Criteria

- [x] tools/index.ts 保留工具工厂/交互类型入口，实际共享 pi context/AbortSignal 适配和 preserveErrorDetails 独立维护。
- [x] 保留 read 原始字节图片准入、home/path 参数准备、pi 二次规范化、错误码与 params 结果，以及取消行为。
- [x] MCP 直接消费实际所需的错误包装，Hook 消费独立只读工具集；均不为了 helper 加载整个工具组装入口。
- [x] 保留 MCP authenticate 工具使用 preserveErrorDetails 的错误路径与原始 MCP 工具的适配路径；不将错误包装无差别增加到所有 MCP 工具。复用 OAuth、配置错误与生命周期公开套件验证迁移。
- [x] 基础工具集与 Hook 只读工具集具有独立工厂，原工具名称、参数、顺序和隐藏条件保持。
- [x] 保留 tools/path.ts 现有职责，当前没有跨领域消费者，不为假设复用另建抽象。
- [x] 更新当前消费者与包类型转导出，删除搬迁后废弃实现；不留下临时破坏等待下一票。

## Verification

01 的协议基线，以及 tools、image read、路径规则、MCP、Agent Hook 模型、取消与 coded error 的现有公开套件。

遵循根 AGENTS.md 的公开行为测试与交付检查要求；每个阶段保持可运行，完整检查安排见 Spec。仅报告实际运行结果。

## Evidence

记录实际测试与静态检查结果，核对错误 details 的 Transcript 持久化及恢复行为，并说明 MCP/Hook 的合法工具消费路径。

## Comments

- 2026-10-07：由已确认设计发布，尚未实施或运行本票代码测试。
- 2026-10-07：实施完成（`b78dbdf`，集成 `470d4b9`，父提交 `b8a1212`）。因实施时未追加证据评论，本条由票 08 在集成点 `ba200b7` 逐条复核后补记；所有命令均在票 08 worktree 实际运行。

  落点：`packages/agent/src/tools/index.ts` 拆为 `tools/runtime.ts`（`createImageReadEnv`、私有 `ImageReadEnv`、`adaptTool`、`preserveErrorDetails`）与 `tools/builtin.ts`（`createReadonlyTools`、`createBuiltinTools`）。`adaptTool` 与 `preserveErrorDetails` 的函数体逐字节未改；`ImageReadEnv` 由类改为 `createImageReadEnv(cwd)` 工厂（类保持私有，因为 pi 的 `readBinaryFile` 返回非导出 `Result`），两个调用方（`createReadonlyTools`、`createBuiltinTools`）使用它，不是单调用点抽象。

  逐条对应：read 原始字节准入在 `ImageReadEnv.readBinaryFile` 覆盖层（`result.ok` 时 `detectReadImageMimeType` + `validateImageBytes`）；home/path 准备在 `adaptTool.prepareArguments`（`prepareFileToolPath(prepared.path, tool.name === "read", env.cwd, homeDir)`）；pi 二次规范化在 `execute` 传入 `pathToFileURL(resolve(env.cwd, params.path)).href`；取消经 `signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT`；错误码与 params 在 `preserveErrorDetails` 捕获 `"code" in error && "params" in error` 后返回 `{ isError: true, content: [message], details: { code, params } }`，其余错误原样抛出。以上代码片段在 `git diff 5c730be:packages/agent/src/tools/index.ts ba200b7:packages/agent/src/tools/runtime.ts` 中均无改动行，diff 只含 import 变化与被移出的工厂。

  消费路径：`packages/agent/src/mcp/index.ts` 只 import `preserveErrorDetails` from `../tools/runtime.ts`（原为 `../tools/index.ts`，`git diff 5c730be..ba200b7 -- packages/agent/src/mcp/` 仅此一行）；`packages/agent/src/hooks/model.ts` 只 import `createReadonlyTools` from `../tools/builtin.ts`。两者都不再加载当时的组装入口 `tools/index.ts`，也不加载今天的 `session/tools.ts`。

  `tools/path.ts`：blob 在 `5c730be` 与 `ba200b7` 均为 `e309963a201c05b794b11822ce84f8daabb733c6`（未改）；唯一消费者是 `tools/runtime.ts:13`，仓库内无跨领域消费者，未新增抽象。

  命令与结果（worktree `agent-module-refactor-08`，`ba200b7`）：
  - `env -u NO_COLOR bun test packages/agent/tests/e2e/tools.test.ts packages/agent/tests/e2e/image-read-and-usage.test.ts packages/agent/tests/e2e/images.test.ts packages/agent/tests/permissions/paths.test.ts packages/agent/tests/e2e/permission-paths.test.ts packages/agent/tests/config/hooks.test.ts packages/agent/tests/e2e/hooks.test.ts packages/agent/tests/e2e/model-hooks.test.ts packages/agent/tests/e2e/unknown-tool-outcomes.test.ts` → 192 pass / 0 fail，9 文件，exit 0。
  - `env -u NO_COLOR bun test packages/agent/tests/e2e/mcp-api.test.ts packages/agent/tests/e2e/mcp-config.test.ts packages/agent/tests/e2e/mcp-oauth.test.ts packages/agent/tests/e2e/mcp-oauth-lifecycle.test.ts` → 见票 01 的 7 套件合跑结果（112 pass / 0 fail，exit 0），四个文件 blob 与 `5c730be` 相同。

  错误码与 Transcript：`tools.test.ts:377`「unavailable bundled ripgrep reports English content and coded UI details」同时断言工具结果 `details: { code: "ripgrep-unavailable", params: { cause: "test binary unavailable" } }`、`session.messages` 中同一条 toolResult 的 `isError` 与 `details`，并断言 `JSON.stringify(fake.contexts)` 不含汉字（Agent Core 保持 locale 无关）；`tools.test.ts:95`「aborting a Run kills bash and its child process and preserves the error in the Transcript」覆盖取消与 Transcript 保留。

  未能验证/限制：
  - AC 第一句"tools/index.ts 保留工具工厂/交互类型入口"在最终树上**已不成立**：`tools/index.ts` 由票 07（`340aa1a`）删除。该条按票 07 的验收被取代——交互类型入口现为 `tools/question.ts` 与各能力 `index.ts`，共享适配与错误包装现为 `tools/runtime.ts`，工厂现为 `tools/builtin.ts` 与各能力工厂。本条的实质要求（工厂与交互类型有入口、共享 pi 适配与 `preserveErrorDetails` 独立维护）仍满足。
  - AC 第三句"均不为了 helper 加载整个工具组装入口"按**组装入口**（`tools/index.ts`、今天的 `session/tools.ts`）成立；但 `hooks/model.ts` 导入的 `tools/builtin.ts` 同时是内置工具工厂模块，因此 Hook 仍会传递加载 `jobs`/`bash`/`todo`/`web-fetch`/`question`/`skill`/`glob`/`grep`/`file-tracking`/`interaction` 模块。本票只要求"独立只读工具集"这一条由 `createReadonlyTools` 与 `createBuiltinTools` 两个独立函数满足；"只读工厂单独成文件"不在本票要求内，票 08 未改动该落点。
  - MCP authenticate 的错误路径与原始工具适配路径本票未改代码，`mcp-oauth.test.ts` / `mcp-oauth-lifecycle.test.ts` / `mcp.test.ts` 全绿且四个文件 blob 与 `5c730be` 相同；这是既有套件保护，不是本票可独立区分的证据。
  - 未运行 `bun run check` 聚合检查（按 Spec 留给票 08）。
