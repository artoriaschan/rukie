# 06: 目录整理

**What to build:** `tools/` 根目录共享运行时支撑移入 `tools/support/` 并同步 `.oxlintrc.json`；`prompt/` 并入 `session/prompt.ts`。详见 [spec](../spec.md)。

Blocked by: 04, 05

Status: resolved

- [x] 导入限制规则仍拒绝能力执行模块导入运行时适配层
- [x] `bun run check:dev` 通过

## Implementation evidence

Shared `runtime.ts`, `path.ts`, `preflight.ts` and `presentation.ts` moved to `tools/support/`; System Prompt moved unchanged to `session/prompt.ts`. All current production/test importers and the isolated Hook module-load assertion use the new locations. `builtin.ts` and `readonly.ts` remain concrete assembly entries; `file-diffs.ts` remains the write/edit protocol adapter. No compatibility exports were retained.

Execution-module import restrictions now cover capability runtime/driver files and moved support runtime paths. Six isolated real Oxlint probes rejected controller/runtime/driver imports of support runtime, controller imports of its protocol tool/global builtin, and permitted protocol adapter imports of support runtime. Temporary probe files were outside the repository and removed.

Verification: 14 pass / 0 fail across Hook module boundary, native tools, Conversation Runtime and Tool Loadout tests in 264ms. `bun run check:dev` passed format, lint, types, Knip, scratch/docs and ink boundaries; `git diff --check` passed. Architecture and ADR-0011 references match the final owners; spec ADR Coverage records Interaction and support/Prompt decisions and the six-part implementation review. Ticket and spec remain claimed until integration code review and the final aggregate gate close them together. No full-suite run in this ticket.

## Final closure

Standards 与 Spec 双轴审阅及后续修正复审已完成，无未解决 finding；ADR 覆盖审阅结论见 [spec](../spec.md#implementation-adr-review)。Integration `9ad8b980` 的完整 `env -u NO_COLOR bun run check` 通过：3192 pass / 0 fail，294 files，105.78s，所有静态与文档检查通过。前七次实际失败及修复证据保留在 spec；本票与 spec 在同一修改中关闭，仅追加交付记录，不再重复完整测试。
