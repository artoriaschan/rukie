# 01: Agent Core Model Selection 入口

Status: resolved

Blocked by: —

**What to build:** 用 `setModelSelection({ model?, thinkingLevel? })` 替换 `setModel`，Session 暴露 `thinkingLevel`。见 spec「Agent Core」。

- 档位按“只往低档降”的规则计算，一次 configure 同时写入模型和档位；返回实际生效的 `{ model, thinkingLevel, clampedFrom? }`。
- `modelState` 升到 v2 `{ model, thinkingLevel }`，兼容 v1；Rewind 和 resume 恢复两者。确认 Rewind 后原生 configure 与 Tool State 一致，只保留一个状态来源。
- 现有 TUI `switchModel` 和 `/model <spec>` 改调新入口，行为不变；删除 `setModel`。

- [x] e2e：只改模型、只改档位、两者同时改；请求携带的 thinking 参数与返回值一致
- [x] e2e：降档、无更低档时取最低档、`reasoning: false` 时为 off
- [x] e2e：Run 中调用报错、并发切换报错、凭据缺失报 `no-api-key`
- [x] e2e：Rewind 到切换前恢复旧选择；resume 恢复保存的选择，不受 `settings.thinking` 影响；v1 modelState 正常读取
- [x] 现有 `model-switch.test.ts`、`image-model-notice.test.ts` 通过

## Comments

- Implemented `setModelSelection` and read-only `thinkingLevel`; removed `setModel` and migrated every repository caller. Model-only TUI commands preserve their behavior; the owning conversation reducer now reads the v2 model mirror.
- Native `configure(tx, ...)` and version 2 `rukie.model` write share one transaction. AgentDoc remains the restore authority; resume/Rewind synchronize runtime selection and legacy v1 mirrors from it. Existing native rewindable/asOf semantics satisfy ADR-0024; no new ADR is required, and the spec coverage and Agent README describe the mirror's role.
- TDD evidence: thinking-only test failed because the new public method was absent, then passed; v1 resume test failed with mirror `off` while native selection was `high`, then passed after migration synchronization. New e2e verifies actual provider request options, downward/minimum/off clamping, concurrent rejection, Rewind and cold resume independent of settings.
- Verification: affected-set run 163 pass / 1 fail across 15 files (10.93s). The failure was the obsolete string-model reducer and reproduced with the direct `/model` test. After fixing it, TUI model-switch plus view conversation tests passed 63/63 (2.71s); Agent model-switch plus actual `tests/tui/e2e/image-model-notice.test.ts` passed 18/18 (4.19s). New selection cases passed 6/6 (838ms), all below one second. Existing direct `/model` case costs ~1.08s for its model Run/abort and terminal integration, with no added waits.
- `bun run check:dev` passed (format, lint, TypeScript, Knip, scratch/docs/ink/test policy); `git diff --check` passed. The first static pass found formatting only in the migrated session-title call, corrected before the passing run. No full aggregate check was run here; final integration acceptance belongs to the integration branch.
