# 02: diff 超限、二进制、读取失败时只列路径

**What to build:** 改动太大、文件非文本、或读取出错时，reminder 不附 diff，只列路径并提示"修改前请重新 read"，且 Run 不中断。这些文件被标记为 stale，供后续过期检查使用。详见 [文件外部修改检测 spec](../spec.md) 的报告规则与失败行为两节。

**Blocked by:** 01

**Status:** resolved

- [x] 单文件 diff 超 4,000 字符只列路径
- [x] 累计超 16,000 字符后余下文件只列路径
- [x] 非 UTF-8 文本只列路径
- [x] 非 ENOENT 的 stat / read 错误只列路径，不抛出
- [x] 只列路径时基线 hash / mtime / size 更新为当前值（不重复报告）、丢弃内存内容、标记 `stale`
- [x] e2e：大改动、多文件超总量、二进制文件三种情形各自只列路径，且不重复报告

## Answer

`file-tracking` 在生成 reminder 时将单文件 diff 限制为 4,000 字符，并将每次模型请求新增的 `file-changes` 内容限制为 16,000 字符；标题、分隔符和路径提醒一起计入预算。prompt 开始收集与请求前收集共享模块内预算，Session 完成请求准备后重置。仅路径提醒超过预算时分批报告，尚未报告的修改与删除保持旧基线，后续请求继续检测，不截断后标记已知。预算细节已补充到 [spec](../spec.md)。

无旧文本、非 UTF-8、含 NUL 或 diff 超限时只列路径，记录当前 hash / mtime / size，丢弃内容并保留 `stale`，直到成功文件工具执行更新基线。`touch` 不会恢复被丢弃的文本。stat / read 失败不会中断 Run；保留最近可得 hash、更新可取得的 metadata，并标记 stale / unavailable，同一不可读状态只报告一次。

验证通过唯一公开接缝 `createSession`：既有 7 个场景与新增 8 个场景共 15 个 e2e 测试、174 次断言，包含 4K 超限、多文件 16K 预算、无效 UTF-8、NUL、真实 ELOOP / EISDIR 错误、重新读取后恢复 diff，以及 90 个长路径的修改和删除分批报告。最后一个场景同时检查每次实际模型请求新增的提醒总量及每个路径最终仅报告一次。

## Comments

- 2026-10-06：从 integration `codex/file-change-detection` 的 `6dae60b53a0b0c3b7d1639d2fa8480c6c562a611` 开始，工作分支 `codex/file-changes-02`。依次记录超限、非文本、文件系统失败、批次预算的 failing e2e，再实现并通过对应测试；过期写入保护留给 ticket 03。
- 2026-10-06：`rtk proxy bun test packages/agent/tests/e2e/file-changes.test.ts`：15 pass、0 fail、174 expect。
- 2026-10-06：`env -u NO_COLOR bun run check`（经 `rtk proxy sh` 执行）：格式、lint、types、Knip 全部通过；1983 pass、0 fail，145 files、10146 expect，223.45s。`rtk git diff --check` 通过。
- 2026-10-06：最终集成检查、审查关闭和工作区归档完成，见 [验收记录](../verification.md)。
