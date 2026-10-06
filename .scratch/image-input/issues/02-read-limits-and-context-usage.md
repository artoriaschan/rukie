# 02: read 图片限额与 Context Usage 计量

**What to build:** 模型 read 超限图片时得到明确的工具错误；图片计入 Context Usage 与 Context Report。详见 [图片输入 spec](../spec.md) 的 read 工具与 Context Usage 两节。

**Blocked by:** 01

**Status:** resolved

- [x] 文件工具包装层在 read 图片文件执行前跑共享检查，超限返回工具错误；主 session 与子代理一致
- [x] user 与 toolResult 中的 image 块按 `ceil(w*h/750)` 估算、单张上限 1,600，解析失败按 1,600；user 归 prompt、toolResult 归 tools；Context Report 同步
- [x] provider 报告的 inputTokens 照旧优先
- [x] e2e：read png/jpeg/gif/webp 结果含 image 块；超限工具错误；子代理 read 图片可用；100×100 图约增 14；超大图封顶 1,600；有 provider 用量时以其为准

## Comments

- 2026-10-06 最终 Standards 审查修复：图片错误码与各自参数归入 `@neant/shared` 的 `UserVisibleErrorData`；Agent Core 仍校验并抛出英文错误。内置和只读 read 经既有 `preserveErrorDetails` 保留 code/params，TUI 删除 class-specific 翻译分支，沿通用错误文案路径处理。公开 `start` 回归先因 read details 为空而 red，随后 zh/en 工具卡及 resume 均 green；下一次模型请求保留原英文 tool content 和精确尺寸参数。
- 最终修复集中验证：10 个相关文件（TUI 图片、路径、token、clipboard、notice、错误恢复及两层 i18n，Agent 图片与 read/usage）142 pass / 0 fail / 700 assertions；`tsc -b`、`oxlint`、`knip`、`oxfmt --check`、`git diff --check` 通过。最终 aggregate 由 root 在集成后运行。

- 2026-10-06 review 修复：公开 read 复现确认 5 MiB + 1 byte、只有 JPEG 签名且无可读宽高的文件仍进入 image result。原因是 guard 错把 `inspectImage` 的维度解析成功当作 pi 的 MIME 接纳条件。共享 images 模块现在用独立 `detectReadImageMimeType` 对齐 pi 的 PNG/JPEG/GIF/WebP 接纳规则，再无条件执行 `validateImageBytes`；保留单次文件读取，无新依赖。
- 新增回归先 red（畸形超限 JPEG 的 `isError: false`、image result）后 green（工具错误且无图片）。同时覆盖小型畸形 JPEG/WebP/GIF/PNG、超限畸形 WebP，以及 pi 仍走文本的 APNG、JPEG-LS、仅 PNG signature；既有 BMP omission 与正常四格式保持通过。相同复现脚本改用本分支源码后输出 `isError: true` 且只有 text result。
- 修复验证：相邻 6 个 e2e 文件 85 pass / 0 fail / 340 assertions，新文件共 26 tests；`env -u NO_COLOR` 下 `tsc -b`、修改文件 `oxlint`、`oxfmt --check` 与 `git diff --check` 通过。基线同步 integration `ef0a1fa`；最终 aggregate check 由 integration 完成。

- 2026-10-06：基于 integration `codex/image-input` 的 `5f20b485`，在独立分支 `codex/image-input-02` 完成。原生 read 的 `NodeExecutionEnv.readBinaryFile` 包装先对原始字节调用共享 `inspectImage` / `validateImageBytes`，再由 pi 编码结果；只读取一次文件，保持 pi 的路径规范化、取消和工具错误流程，不注入 imageProcessor。内置和只读 hook 工具组装都使用该边界，主 Session 与 Subagent 共用。
- Guard 按文件头识别 PNG/JPEG/GIF/WebP，检查 byte 上限、两侧维度与零维度；无图片扩展名的超限 PNG 也拒绝。BMP 不进入该 guard，仍返回 pi 的 imageProcessor omission 文本。四种受支持格式保持原始 base64 和 MIME 的原生 image result。
- Context Usage 的 prompt / tools image 块分别计入原类别，按 `ceil(width * height / 750)`、上限 1600；无法解析或零维度的历史图片回退 1600。Context Report 复用同一计量，不新增分类或状态。provider input + cacheRead + cacheWrite 继续优先作为 used 总量，segment / category 保留估算归因。
- TDD：超 5 MB 的 read 在 red 时把 image 发给模型，green 时转为工具错误；100×100 prompt image 在 red 时 messages 只有文本 1 token，green 后为 15（文本 1 + 图片 14）。其后扩展支持格式、width / height 超限、零宽、Subagent 成功与超限、BMP、tools 归类和 resume、cap/fallback 与 provider override 的公开 Session 测试。
- 验证：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/image-read-and-usage.test.ts packages/agent/tests/e2e/images.test.ts packages/agent/tests/e2e/tools.test.ts packages/agent/tests/e2e/context-usage.test.ts packages/agent/tests/e2e/context-report.test.ts packages/agent/tests/e2e/subagents.test.ts`：76 pass / 0 fail / 322 assertions，其中新文件 17 tests。`rtk proxy env -u NO_COLOR bunx --no -- tsc -b`、修改文件 `oxlint` / `oxfmt` 通过；全仓 aggregate check 由 integration 合并后运行。
