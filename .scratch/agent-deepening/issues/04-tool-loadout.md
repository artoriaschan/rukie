# 04: Tool Loadout

**What to build:** `session/tools.ts` 吸收 `rebuildTools`、`refreshChildTools`、`childLoadout`、声明 diff、MCP drift 判定与子代理排除名单，root 与 child 共用；不新增缓存。详见 [spec](../spec.md)。

Blocked by: 03

Status: resolved

- [x] Session 不再直接调用 `planToolSearchLoadout`
- [x] `tests/session/tools.test.ts` 覆盖排序、替换、child 限制与延迟阈值
- [x] tool-declarations、tool-search、tool-search-children e2e 通过

## Answer

`session/tools.ts` owns root rebuild/discovery and child registration refresh, built-in/capability assembly and child exclusions, ToolSearch catalog filtering, Transcript-derived planning, complete-history fallback when a new context lacks a baseline, positional declaration deltas and MCP drift. Session supplies capability options and installs its single native extension; it no longer stores a separate registration inventory or directly calls `planToolSearchLoadout`. Late MCP deltas are committed before request message reconstruction. No discovered-tool cache was introduced.

Verification: 49 tests passed across module tools, tool-declarations, tool-search and tool-search-children in 3.78s. Seven module cases cover child restrictions, exact/above strict threshold, authentication visibility, Transcript ordering/changed declaration replacement, append versus complete replacement, reset-history fallback/fresh-child planning and MCP drift. `bun run check:dev` passed after correcting readonly array typing; `git diff --check` passed. No full check or push here; final spec acceptance owns aggregate verification.

Equivalent threshold e2e pair migrated to the module seam: measured before 86.91ms / 66.53ms (274ms file invocation), after 0.36ms / 0.25ms (111ms module invocation). Session protocol smoke remains for automatic modes, late MCP discovery, authentication, child allowlists, compaction, resume, Rewind, permissions and cancellation. All focused cases complete below one second. ADR coverage follows ADR-0011 composition, ADR-0024 native Transcript preparation and ADR-0026 no discovery cache; no persisted-format change.
