# 03: 写入前过期检查

**What to build:** 模型 edit / write 一个读后被外部改过、尚未看到改动的文件时，工具返回错误要求先重读，磁盘上的外部改动保持不变。看过 diff、或重读之后可以正常写；从未读过的新文件照常 write。详见 [文件外部修改检测 spec](../spec.md) 的过期检查一节。

Blocked by: 02

Status: resolved

- [x] write / edit 执行前：目标在跟踪集中且（`stale` 或当前 hash ≠ 基线）时返回 "File has been modified since it was last read. Read it again before editing."，不执行
- [x] read 清除 `stale` 并重置基线
- [x] 不在跟踪集中的文件：write 照常，edit 交给 pi 原有行为
- [x] e2e：read → 外部改 → 未报告即 edit / write 被拒且磁盘为外部版本；diff 报告后 edit 成功；只列路径报告后 edit 仍被拒，re-read 后成功；新文件 write 成功

## Comments

- 2026-10-06：从集成分支 `codex/file-change-detection` 的 `1ea3b82` 创建票分支 `codex/file-changes-03`，通过 `git merge-base --is-ancestor` 确认基线。
- Red：`rtk proxy bun test packages/agent/tests/e2e/file-changes.test.ts -t 'refuses an unreported'` 在依赖安装后得到 0 pass / 2 fail；`write` 和 `edit` 都返回成功并覆盖外部改动。回归保持相同 size 与 mtime，且 edit 的 oldText 仍可匹配，验证执行前必须比较内容。
- Green：`file-tracking` 包装层对已跟踪的最终路径比较 SHA-256；`stale`、内容变化或无法读取当前文件时抛出规定工具错误，原工具不执行，基线不推进。成功 read 通过原有基线更新清除 stale。通过公共 `createSession` 接缝覆盖路径提醒后的 write/edit 拒绝与重读恢复、已报告 diff 后 edit、不在跟踪集的 write/edit，以及 PreToolUse 改写路径后的保护。
- 验证：`rtk proxy bun test packages/agent/tests/e2e/file-changes.test.ts`，22 pass / 0 fail / 203 assertions；`rtk proxy bunx --no -- oxfmt --check`、`rtk proxy bunx --no -- oxlint`、`rtk proxy bunx --no -- tsc -b`、`rtk proxy bunx --no -- knip`、`rtk git diff --check` 全部 exit 0。本票不重复运行全仓测试；最终集成分支的 `env -u NO_COLOR bun run check` 由主代理统一验证。
- 2026-10-06：最终集成完整检查已通过，审查与工作区归档完成，见 [验收记录](../verification.md)。
