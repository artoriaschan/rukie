# 03: activity 双语句池与 narration 指令

Status: done

**What to build:** 英文环境下 activity 行全英文：思考、等待、工具动作、完成、失败、夜间、周末、节日、彩蛋、续跑、压缩、评审、审批等句子，以及完成前缀、工具计数、连击、总耗时等结构性文案；模型收到英文 narration 指令，写出的 `⏵` 状态行为英文。中文环境行为不变。见 spec Implementation Decisions 的 TUI 节（activity、narration）。

**Blocked by:** 01

- [x] 句池沿用单文件布局，每个中文池后紧跟 `EN_` 英文镜像，对齐 dsh-working-activity 0.5.1（`~/.dsh/profiles/dsh-tui/node_modules/dsh-working-activity/src/phrases.ts`）；能对应的照搬上游 `EN_*`
- [x] Neant 独有的 `REVIEW_PHRASES` 及比上游多出的 `ACTION_MAP` 条目自写英文，保持趣味风格
- [x] 取句按启动时 locale 选择池子；节日与春节日期表两种 locale 共用
- [x] 保留 BSD 版权头与 "Adapted from dsh-working-activity 0.5.1" 说明
- [x] 结构性文案进 TUI 字典，key 对齐上游 `lang.ts`；工具计数 `-one` / `-many`（`1 tool` / `2 tools`）
- [x] activity 改用 `@neant/i18n` 的 `fmtDuration`，删除 TUI 内旧实现
- [x] narration 指令进字典，zh / en 两版按 locale 注入；en 版照上游 `lang.ts` 英文指令
- [x] 测试：每个中文句池有非空 `EN_` 镜像；e2e 覆盖 en 下 activity 行文本与 narration reminder 文本；现有 narration / activity 测试在 zh 下仍通过
- [x] `tsc -b` 与全部测试通过

## Comments

### 2026-10-03 — implemented and reviewed

Implemented on `codex/i18n-issues-02-05`: `62d6dec`; Standards repair `39e0f02`.
Scope: 18 Chinese activity pools gain adjacent non-empty `EN_` mirrors;
16 corresponding English pools and all 22 original English action pools exactly
match dsh-working-activity 0.5.1. Five Neant-specific action alias groups and
REVIEW copy are authored locally. Shared calendar dates and BSD provenance stay
in the single phrase file. Activity holds its startup locale across Runs;
structure copy uses app dictionary keys from upstream, counts handle one/many,
and duration uses `@neant/i18n`. Both narration instructions match upstream
`lang.ts` exactly and are injected through the fixed startup translator.

Public TDD: English main/start activity red (Chinese waiting/elapsed text),
then green; English narration env/settings cases red (English reminder absent),
then green. Existing Chinese activity/narration tests pass. Full validation
exposed one old main/resume test relying on ambient locale; its explicit Chinese
assertion now has `env: { LANG: "zh_CN.UTF-8" }`, verified red then green.
Mirror coverage checks all 18 pools for non-empty English strings, including
nested actions/tiers/holidays, and shared Gregorian/Lunar holiday boundaries.
English public activity tests also cover one/many tools, durations, aliases,
streaks, compaction, review/approval priority, failures and interruption.

Validation: regular `rtk proxy bunx tsc -b`; final focused 68 pass / 1334
assertions. Final `rtk proxy env -u NO_COLOR bun run check`: formatting, lint,
typecheck, Knip and 584 tests / 3965 assertions pass (51 files).
Evidence: `/tmp/neant-i18n-issue03-check.log` and
`/tmp/neant-i18n-issue03-upstream.log`.

Review fixed point: `07005ba`; `git diff 07005ba...HEAD`.
Standards: 1 P3 (mirror test directory did not mirror its source), fixed by
moving to `tests/screens/chat/activity/phrases.test.ts` in `39e0f02`;
original reviewer rechecked and confirmed 0 remaining/new findings.
Spec: 0 findings. No unresolved items. Issues 04/05 remain untouched.
