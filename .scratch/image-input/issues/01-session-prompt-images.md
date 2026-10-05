# 01: Session prompt 带图片

**What to build:** SDK 调用方用 `run(prompt, { images })` / `steer(prompt, { images })` 把图片随 prompt 交给模型；超限或非图片数据在 Run 开始前被拒。图片随 Transcript 持久化，resume 后仍在。详见 [图片输入 spec](../spec.md) 的共享图片检查、Session API、存储、compaction、UserPromptSubmit hook 几节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 新领域模块（共享图片检查）：按 magic bytes 识别 png/jpeg/gif/webp，从文件头读宽高；超 5 MB 或任一边超 8000 px 拒绝并给出原因；经 `@neant/agent` 导出供 TUI 使用
- [ ] `run` / `steer` options 增加 `images?: Array<{ data; mimeType; name? }>`；任一图片检查失败则调用被拒、无模型请求
- [ ] user 消息为文本 + 按序图片；`name` 存于消息供 frontend 显示，`convertToLlm` 时剥离
- [ ] hooks、Session Title、输入历史的取文本逻辑只取 text 块；UserPromptSubmit 改写只改文本、图片保留
- [ ] 确认 compaction 摘要请求不含 base64 文本，必要时替换为 `[image]`
- [ ] e2e：请求内容顺序与 `name` 剥离；`steer` 带图；三类拒绝；resume 后下一次请求仍带图片；compaction 后继续；UserPromptSubmit 收到纯文本；Session Title 只用文本
