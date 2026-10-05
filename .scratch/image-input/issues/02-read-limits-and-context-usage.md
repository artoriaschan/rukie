# 02: read 图片限额与 Context Usage 计量

**What to build:** 模型 read 超限图片时得到明确的工具错误；图片计入 Context Usage 与 Context Report。详见 [图片输入 spec](../spec.md) 的 read 工具与 Context Usage 两节。

**Blocked by:** 01

**Status:** resolved

- [x] 文件工具包装层在 read 图片文件执行前跑共享检查，超限返回工具错误；主 session 与子代理一致
- [x] user 与 toolResult 中的 image 块按 `ceil(w*h/750)` 估算、单张上限 1,600，解析失败按 1,600；user 归 prompt、toolResult 归 tools；Context Report 同步
- [x] provider 报告的 inputTokens 照旧优先
- [x] e2e：read png/jpeg/gif/webp 结果含 image 块；超限工具错误；子代理 read 图片可用；100×100 图约增 14；超大图封顶 1,600；有 provider 用量时以其为准

## Comments

- 2026-10-06：基于 integration `codex/image-input` 的 `5f20b485`，在独立分支 `codex/image-input-02` 完成。原生 read 的 `NodeExecutionEnv.readBinaryFile` 包装先对原始字节调用共享 `inspectImage` / `validateImageBytes`，再由 pi 编码结果；只读取一次文件，保持 pi 的路径规范化、取消和工具错误流程，不注入 imageProcessor。内置和只读 hook 工具组装都使用该边界，主 Session 与 Subagent 共用。
- Guard 按文件头识别 PNG/JPEG/GIF/WebP，检查 byte 上限、两侧维度与零维度；无图片扩展名的超限 PNG 也拒绝。BMP 不进入该 guard，仍返回 pi 的 imageProcessor omission 文本。四种受支持格式保持原始 base64 和 MIME 的原生 image result。
- Context Usage 的 prompt / tools image 块分别计入原类别，按 `ceil(width * height / 750)`、上限 1600；无法解析或零维度的历史图片回退 1600。Context Report 复用同一计量，不新增分类或状态。provider input + cacheRead + cacheWrite 继续优先作为 used 总量，segment / category 保留估算归因。
- TDD：超 5 MB 的 read 在 red 时把 image 发给模型，green 时转为工具错误；100×100 prompt image 在 red 时 messages 只有文本 1 token，green 后为 15（文本 1 + 图片 14）。其后扩展支持格式、width / height 超限、零宽、Subagent 成功与超限、BMP、tools 归类和 resume、cap/fallback 与 provider override 的公开 Session 测试。
- 验证：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/e2e/image-read-and-usage.test.ts packages/agent/tests/e2e/images.test.ts packages/agent/tests/e2e/tools.test.ts packages/agent/tests/e2e/context-usage.test.ts packages/agent/tests/e2e/context-report.test.ts packages/agent/tests/e2e/subagents.test.ts`：76 pass / 0 fail / 322 assertions，其中新文件 17 tests。`rtk proxy env -u NO_COLOR bunx --no -- tsc -b`、修改文件 `oxlint` / `oxfmt` 通过；全仓 aggregate check 由 integration 合并后运行。
