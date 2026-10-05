# 01: Session prompt 带图片

**What to build:** SDK 调用方用 `run(prompt, { images })` / `steer(prompt, { images })` 把图片随 prompt 交给模型；超限或非图片数据在 Run 开始前被拒。图片随 Transcript 持久化，resume 后仍在。详见 [图片输入 spec](../spec.md) 的共享图片检查、Session API、存储、compaction、UserPromptSubmit hook 几节。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 新领域模块（共享图片检查）：按 magic bytes 识别 png/jpeg/gif/webp，从文件头读宽高；超 5 MB 或任一边超 8000 px 拒绝并给出原因；经 `@neant/agent` 导出供 TUI 使用
- [x] `run` / `steer` options 增加 `images?: Array<{ data; mimeType; name? }>`；任一图片检查失败则调用被拒、无模型请求
- [x] user 消息为文本 + 按序图片；`name` 存于消息供 frontend 显示，`convertToLlm` 时剥离
- [x] hooks、Session Title、输入历史的取文本逻辑只取 text 块；UserPromptSubmit 改写只改文本、图片保留
- [x] 确认 compaction 摘要请求不含 base64 文本，必要时替换为 `[image]`
- [x] e2e：请求内容顺序与 `name` 剥离；`steer` 带图；三类拒绝；resume 后下一次请求仍带图片；compaction 后继续；UserPromptSubmit 收到纯文本；Session Title 只用文本

## Comments

- 2026-10-06：基于 integration `codex/image-input` 的 `4b58bb1`，在独立分支 `codex/image-input-01` 完成。新增 `packages/agent/src/images/`，公开 `PromptImage`、`ImageInfo`、`validateImage`、`validateImageBytes`、`inspectImage`、`ImageValidationError` / `ImageValidationCode`。检查上限为 5 × 1024 × 1024 bytes、8000 px；支持 JPEG metadata 跳过和 WebP VP8 / VP8L / VP8X。错误提供 `code` 与 `params`，后续 TUI 可本地化。
- `run` 在更改运行状态、发送事件、执行 prompt hook 前检查全部图片；`steer` 在入队前检查。user content 保持 text + 调用方图片顺序。`UserMessage.imageNames` 与 image 块按序对应，无名称用 `null`，只随 Transcript 保存，在 `convertToLlm` 剥离（也覆盖 steer 的 Skill Invocation）。resume 原生内联恢复。
- 当前 UserPromptSubmit 协议只支持附加上下文和阻断，没有 `updatedPrompt`；保留现有协议。测试验证纯文本 hook payload、附加上下文后图片保留、Session Title 请求不含图片。现有 prompt-text 投影只提取 text 块；resume 的 Checkpoint preview 也验证只含文本。TUI 输入历史保持现有文本入口，图片绑定由后续票处理。
- 已检查锁定 pi-agent-core 0.99.2 的 `harness/compaction/utils.js`：`serializeConversation` 用 `contentText` 忽略图片块。端到端验证摘要请求不含 base64，compact 后 resume 继续 Run；无需另加替换路径。
- TDD：先观察请求缺少图片的 red，再实现；非图片、byte 超限、width / height 超限、GIF、JPEG、WebP、steer 入队检查分别记录 red → green。`packages/agent/tests/e2e/images.test.ts` 17 tests / 64 assertions 全通过。
- 验证：`rtk bun test packages/agent/tests/e2e/images.test.ts packages/agent/tests/e2e/prompt-hooks.test.ts packages/agent/tests/e2e/session-title.test.ts packages/agent/tests/e2e/compaction.test.ts`：63 pass / 0 fail；`rtk bunx --no -- tsc -b` 通过；修改源码与测试的 `oxlint` 通过。全仓 aggregate check 留给 integration 合并后的总体验证。
