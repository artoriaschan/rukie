# 04: Agent Core 错误码与英文拒绝原因

Status: resolved

**What to build:** Agent Core 不再产出中文（ADR-0008）。ripgrep 不可用、未配置模型、未知模型、缺少 API key、session 不存在这五种错误在 TUI 中按 locale 显示；模型收到的工具拒绝原因固定英文，transcript 不含界面语言。见 spec Implementation Decisions 的 `@neant/shared`、Agent Core、TUI（错误展示）节。

Blocked by: 01

- [x] `@neant/shared` 新增用户可见错误码联合类型与带码错误形状 `{ code, params }`：`ripgrep-unavailable`（cause）、`no-model`（settings 路径）、`unknown-model`（model）、`no-api-key`（provider、env）、`session-not-found`（id）
- [x] Agent Core 上述五处抛出带 `code` / `params` 的错误，`message` 英文
- [x] 权限拒绝 reason 改英文（auto-review 下用户拒绝、未授权两种）
- [x] `@neant/i18n` 通用文案补齐五个错误码 zh / en，类型上与错误码联合类型绑定，漏写报错
- [x] TUI 展示 Agent Core 错误：带码查通用文案，不带码显示原 `message`
- [x] Agent Core 不依赖 `@neant/i18n`，不引入 locale 参数
- [x] 测试：agent permissions / tools / config 测试断言英文 reason 与正确 `code` / `params`；TUI e2e 覆盖带码错误在 zh / en 下的文本、不带码错误原样显示
- [x] `tsc -b` 与全部测试通过

## Comments

- 2026-10-03: completed via `/implement` and `/tdd`, implementation `7a6e954`
  on `codex/i18n-issues-02-05`. Five shared error codes have discriminated
  parameters; Core English Error messages and permission refusal reasons remain
  locale-independent. Common error keys are tied to the shared code union.
- TUI translates startup/runtime failures and coded tool details in live/replay
  paths. The builtin-tool boundary preserves code/params through pi's exception
  flattening; model/transcript content stays English. Unknown codes, absent codes,
  malformed parameters and non-Error failures preserve original information.
  The no-model guidance retains the complete provider example in both languages;
  missing builtin env names receive localized standard-environment guidance.
- Public API red/green slices: config codes, resume-id rejection, permission
  refusal reasons, ripgrep error details, common-copy interpolation, startup
  settings locale, live tools and missing-env guidance. Virtual terminal coverage
  includes all five codes in zh/en, runtime errors and cross-locale tool replay.
  Compile-only negative checks cover code/params mismatch, missing translation
  key and incorrect interpolation parameters.
- Validation: focused main/CLI/i18n regression 108 pass / 503 assertions;
  regular `rtk proxy bunx tsc -b` passed. Final
  `rtk proxy env -u NO_COLOR bun run check` passed formatting, lint, tsc, Knip
  and 614 tests / 4038 assertions (52 files). Log:
  `/tmp/neant-i18n-issue04-check.log`. The first full run found three legacy
  localization assertions; they were updated to the new Core/TUI contract and
  passed focused plus full revalidation. Headless CLI source remains unchanged.
- `/code-review` fixed point `e453078`, diff `git diff e453078...HEAD`:
  independent Standards review 0 findings; Spec review 0 findings.
  Logs: `/tmp/neant-i18n-issue04-review-standards.md` and
  `/tmp/neant-i18n-issue04-review-spec.md`. No unresolved findings.
  Issue 05 remains pending; no branch switch, worktree, merge or push performed.
