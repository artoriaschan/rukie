# 06: 目录整理

**What to build:** `tools/` 根目录共享运行时支撑移入 `tools/support/` 并同步 `.oxlintrc.json`；`prompt/` 并入 `session/prompt.ts`。详见 [spec](../spec.md)。

Blocked by: 04, 05

Status: claimed

- [x] 导入限制规则仍拒绝能力执行模块导入运行时适配层
- [x] `bun run check:dev` 通过

## Implementation evidence

Shared `runtime.ts`, `path.ts`, `preflight.ts` and `presentation.ts` moved to `tools/support/`; System Prompt moved unchanged to `session/prompt.ts`. All current production/test importers and the isolated Hook module-load assertion use the new locations. `builtin.ts` and `readonly.ts` remain concrete assembly entries; `file-diffs.ts` remains the write/edit protocol adapter. No compatibility exports were retained.

Execution-module import restrictions now cover capability runtime/driver files and moved support runtime paths. Six isolated real Oxlint probes rejected controller/runtime/driver imports of support runtime, controller imports of its protocol tool/global builtin, and permitted protocol adapter imports of support runtime. Temporary probe files were outside the repository and removed.

Verification: 14 pass / 0 fail across Hook module boundary, native tools, Conversation Runtime and Tool Loadout tests in 264ms. `bun run check:dev` passed format, lint, types, Knip, scratch/docs and ink boundaries; `git diff --check` passed. Architecture and ADR-0011 references match the final owners; spec ADR Coverage records Interaction and support/Prompt decisions and the six-part implementation review. Ticket and spec remain claimed until integration code review and the final aggregate gate close them together. No full-suite run in this ticket.
