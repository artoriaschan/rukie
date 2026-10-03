# 05: 硬编码中文扫描测试

Status: done

**What to build:** 开发者在 TUI 字典与 activity 句池文件之外写中文硬编码时测试失败，新文案无法绕过 i18n。见 spec Testing Decisions 的硬编码扫描。

**Blocked by:** 02, 03, 04

- [x] bun:test 用例扫描 TUI 源码，字典与句池文件之外出现 `\p{Han}` 即失败，失败信息列出文件与行号
- [x] 同样覆盖 Agent Core 源码（ADR-0008：Agent Core 不产出中文）
- [x] 注释中的中文是否放行：按实际扫描结果决定并在用例中写明
- [x] 当前代码库下用例通过

## Comments

2026-10-03：实现提交 `4d76e2d`，在当前 `codex/i18n-issues-02-05` 分支完成。

- 扫描 `apps/neant-tui/src`、`packages/agent/src`，并以同一规则保护 `packages/tui/src`。所有源码文件均递归扫描，包含隐藏文件和非 TS 文件。
- 只豁免两个精确路径：`apps/neant-tui/src/i18n/locales.ts` 与 `apps/neant-tui/src/screens/chat/activity/phrases.ts`，无目录或文件名白名单。
- 首次扫描确认其余源码没有中文注释或文案，因此中文注释也禁止；用例明确覆盖行注释与块注释。JavaScript 使用 `\p{Script=Han}` 的 Unicode 模式，覆盖扩展区汉字。
- `/tdd` 两轮红绿证明硬编码会失败、每个文件与一基行号准确，以及只有精确字典/句池可以含汉字。另覆盖相邻新文件、别处同名文件、隐藏 JSON、CRLF 和当前源码通过。focused 扫描 5 pass；与 main 回归一起 41 pass / 163 assertions；多轮 `rtk proxy bunx tsc -b` 通过。
- 首两轮完整检查均触发旧 resume 用例 5 秒超时。单例、整 main 文件和 TUI 范围通过；公开 `SessionStore.close` 门控实验确认回复已显示但 Run 未结束时 Ctrl+D 被忽略，旧测试稳定红。仅增加等待公开终端空闲后再发送 Ctrl+D，同一门控实验绿。最终仅保留这一行测试维护，没有产品改动、固定等待或 timeout 调整，临时门控和日志均已移除。
- 最终 `rtk proxy env -u NO_COLOR bun run check` exit 0：formatting、lint、tsc、Knip、619 tests / 4043 assertions（53 files）全部通过。
- `/code-review` 固定基线 `bbadd8d`，diff `git diff bbadd8d...HEAD`：Standards 0 findings；Spec 0 findings。额外 renderer 扫描和最小 resume 测试维护均经审查；无未解决项。

证据：`/tmp/neant-i18n-issue05-check.log`、`/tmp/neant-i18n-issue05-green-regression.log`、`/tmp/neant-i18n-issue05-{red,green}-{locations,allowlist}.log`、`/tmp/neant-i18n-issue05-green-scan.log`。首次失败与再次失败分别保留为 `check-first.log`、`check-second.log`；诊断门控证据为 `resume-gate-red.log`、`resume-gate-green.log`、`resume-gate-source.ts`（均使用 `/tmp/neant-i18n-issue05-` 前缀）。独立审查记录：`/tmp/neant-i18n-issue05-review-standards.md` 与 `/tmp/neant-i18n-issue05-review-spec.md`。
