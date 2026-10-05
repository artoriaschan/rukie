# 02: read 图片限额与 Context Usage 计量

**What to build:** 模型 read 超限图片时得到明确的工具错误；图片计入 Context Usage 与 Context Report。详见 [图片输入 spec](../spec.md) 的 read 工具与 Context Usage 两节。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 文件工具包装层在 read 图片文件执行前跑共享检查，超限返回工具错误；主 session 与子代理一致
- [ ] user 与 toolResult 中的 image 块按 `ceil(w*h/750)` 估算、单张上限 1,600，解析失败按 1,600；user 归 prompt、toolResult 归 tools；Context Report 同步
- [ ] provider 报告的 inputTokens 照旧优先
- [ ] e2e：read png/jpeg/gif/webp 结果含 image 块；超限工具错误；子代理 read 图片可用；100×100 图约增 14；超大图封顶 1,600；有 provider 用量时以其为准
