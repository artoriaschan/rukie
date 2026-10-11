# 23: ui、server、desktop 三包骨架与本地测试接入

**What to build:** 建立三个 workspace 包与它们的检查链：`@rukie/shared` 中的 wire 命令 schema 骨架、ui 五层目录与 lint 边界、Vitest 接入与 runner 边界、字号 lint。见 [spec](../spec.md) 的「包结构」「Testing Decisions」与 [ADR-0029](../../../docs/adr/0029-desktop-package-structure.md)。

Blocked by: None (can start immediately)

Status: resolved

- [x] `packages/ui`、`packages/server`、`packages/desktop` 以 `workspace:*` 互相引用，`tsc -b`、`knip` 通过
- [x] `.oxlintrc.json` 按目录强制 ui 五层依赖方向，以及 ui 禁止值导入 `@rukie/agent`、禁止 `@rukie/coding-agent`、`electron`、`node:*`、`bun`、`bun:*`；各有一条违规样例被拦截
- [x] 根 `bunfig.toml` 用 `pathIgnorePatterns` 排除 ui 与 desktop，`bun test`、`--parallel`、`--shard` 都不收集 Vitest 文件
- [x] `test:desktop` 运行 ui（browser mode + Node 环境）与 desktop（Node）各一个示例测试，只加入本地 `check`，不加入 `check:dev`
- [x] `check:test-policy` 新增 runner 边界规则并有回归样例
- [x] `scripts/check-*.ts` 禁止 ui 中非 `text-ui-*` 的字号类与内联 `fontSize`，接入 `check:dev`
- [x] 依赖精确锁定，`docs/tech-stack.md` 与 lockfile 同步（vitest 5.0.3 等）；AGENTS.md 与 `docs/testing.md` 写明 ui/desktop PR 须附本地 `test:desktop` 证据与 `playwright install --only-shell chromium` 前置步骤

## Implementation evidence

Status remains `claimed` until integrated review and acceptance. Scope follows ADR-0029 and ADR-0004; wire input schema follows ADR-0031. No new architectural decision was introduced.

- Added ui/server/desktop source-exporting workspaces, references, five UI layers, injected `DesktopHost`, and shared MVP `WireCommandSchema`/`WireCommand`/`WIRE_SUBPROTOCOL`. Server's public `parseWireCommand` rejects malformed, unknown and excess input fields.
- Added UI import rules with type-only Agent imports, forbidden frontend/runtime imports, upward/sibling dependencies and React/Zustand restrictions. CLI regression checks 24 forbidden cases and permits downward and type imports.
- Red-green evidence: runner boundary first failed four package/runner cases; CLI import boundary failed before rules; wire test failed on missing shared schema export then passed; typography rejection checks failed before checker and later reproduced quoted/computed fontSize bypasses before repair. Runner alternate import/reexport cases also reproduced failures before repair.
- Local focused checks: 30 tests across checker regression files and server schema tests, with no failures; individual fixture collection test ~65 ms, CLI lint fixture ~165 ms. No new focused case takes over one second.
- `bun run test:desktop`: 3 tests pass across ui Chromium browser, ui Node and desktop Node projects, ~1.7 s total. Browser startup is required integration cost for a real DOM runner; Node tests assert Bun is absent. Initial missing-browser failure was repaired by documented `bunx --no -- playwright install --only-shell chromium`, which completed successfully.
- Isolated collection fixture checks normal `bun test`, `--parallel=2`, `--shard=1/2` and `--shard=2/2`; each excludes intentionally failing ui/desktop sentinel files. No broad Bun suite was run for collection verification.
- `bun run check:dev` passes format/lint/tsc/Knip/tracker/docs/import/test policy/typography checks. Root `check` includes `test:desktop`, `check:dev` does not; CI was not changed and has no desktop acceptance evidence.
- Toolchain observed: Bun 1.4.2, Node 26.10.0; exact target dependency versions were installed and frozen in `bun.lock`. ui's React/React DOM peers are exact; unused future Agent/Hono/Effect/Electron runtime dependencies await their owning implementation tickets. There are no production React DOM components in this scaffold, so browser app acceptance belongs to GUI tickets.
- Updated AGENTS.md, testing/architecture/tech-stack and ADR-0004 facts; root CLAUDE.md symlink remains unchanged. The spec's ADR Coverage already owns these choices and final review remains with integration.

Integrated `feat/desktop-mvp` through `019beae0` before handoff. Added optional image `name` matching PromptImage after reproducing rejection through public wire parsing; focused wire tests now pass both named and unnamed images.

## Answer

ui/server/desktop workspace、五层导入和字号检查、Bun/Vitest 收集边界已接入；桌面测试仅进入本地 check，不进入 CI 分片。

最终代码集成 `8af81b85`；独立双轴评审、后续修复、适用本地验证和 ADR Coverage 结论见 [spec 的交付证据](../spec.md#delivery-evidence)。本地工作已完成，最终推送的 CI 尚待验收；此状态不表示 PR 已合并。
