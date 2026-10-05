# 03: Session 标题与 `/rename`

**What to build:** 每个 session 自动获得 Session Title：首条 prompt 发出后立即以清洗截断的 prompt 作标题，随后模型异步总结一次；用户可用 `/rename` 改名并固定。标题显示在终端标题上。见 [spec](../spec.md) 的“Session 标题”。

**Blocked by:** 01（命令框架与补全菜单）

**Status:** ready-for-agent

- [ ] 新概念目录 `session-title`；标题存 pi session name，来源（`prompt` / `model` / `user`）记 Tool State；Session 暴露 `title` / `titleSource`
- [ ] 首条 user prompt 写入后立即写 fallback：去控制字符与 ANSI、折叠空白、截到 40 个 UTF-8 字节（不切断码点、无省略号）
- [ ] 异步一次模型调用，不阻塞 run：单轮无工具，prompt 照 deepseek-harness `session-title-llm`（同消息语言，非 CJK ≈5 词 / CJK ≈10 字），输入上限 4KB、输出上限 64 token、结果截到 80 字节；只针对首条 prompt
- [ ] 失败只发告警通知、保留 fallback
- [ ] settings 新增可选 `titleModel`，缺省用主模型
- [ ] 子 session 不调模型，标题取委派描述
- [ ] 新增事件 `session_title_changed { title, source }`
- [ ] `rename(title)`：来源 `user`，中止进行中的生成；生成完成时若来源已是 `user` 则丢弃；空闲与 run 中都可用
- [ ] TUI `/rename <标题>` 接入（run 中可用）；无参数时输入框预填 `/rename <当前标题>`
- [ ] 终端标题以 OSC 0 写 `✦ <标题>`，运行中 `✦` 换成 spinner 帧
- [ ] Headless 同样生成标题
- [ ] 测试工具：`controlledModel` 按 `controlReviews` 的方式把标题生成调用分到独立队列，主对话 `calls` 不受影响
- [ ] Agent Core e2e 与 TUI 测试覆盖以上行为
