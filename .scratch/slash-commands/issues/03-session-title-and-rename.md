# 03: Session 标题与 `/rename`

**What to build:** 每个 session 自动获得 Session Title：首条 prompt 发出后立即以清洗截断的 prompt 作标题，随后模型异步总结一次；用户可用 `/rename` 改名并固定。标题显示在终端标题上。见 [spec](../spec.md) 的“Session 标题”。

**Blocked by:** 01（命令框架与补全菜单）

**Status:** resolved

- [x] 新概念目录 `session-title`；标题存 pi session name，来源（`prompt` / `model` / `user`）记 Tool State；Session 暴露 `title` / `titleSource`
- [x] 首条 user prompt 写入后立即写 fallback：去控制字符与 ANSI、折叠空白、截到 40 个 UTF-8 字节（不切断码点、无省略号）
- [x] 异步一次模型调用，不阻塞 run：单轮无工具，prompt 照 deepseek-harness `session-title-llm`（同消息语言，非 CJK ≈5 词 / CJK ≈10 字），输入上限 4KB、输出上限 64 token、结果截到 80 字节；只针对首条 prompt
- [x] 失败只发告警通知、保留 fallback
- [x] settings 新增可选 `titleModel`，缺省用主模型
- [x] 子 session 不调模型，标题取委派描述
- [x] 新增事件 `session_title_changed { title, source }`
- [x] `rename(title)`：来源 `user`，中止进行中的生成；生成完成时若来源已是 `user` 则丢弃；空闲与 run 中都可用
- [x] TUI `/rename <标题>` 接入（run 中可用）；无参数时输入框预填 `/rename <当前标题>`
- [x] 终端标题以 OSC 0 写 `✦ <标题>`，运行中 `✦` 换成 spinner 帧
- [x] Headless 同样生成标题
- [x] 测试工具：`controlledModel` 按 `controlReviews` 的方式把标题生成调用分到独立队列，主对话 `calls` 不受影响
- [x] Agent Core e2e 与 TUI 测试覆盖以上行为

## Answer

已实现 Session Title 与 `/rename`，实现提交 `80797bd`；存储竞争修复 `94128bf`，完整手动/委派标题修复 `8a49d57`，回退锚点兼容修复 `3c68f87`。本工单分支已并入 integration 的 02 / 05 / 08 最新基线。

- 新 `session-title` 概念负责一次性的辅助请求、取消、超时与失败告警；标题用 pi native name 持久化，来源用 `tool-state/title-source` v1 的 `prompt` / `model` / `user` 值记录。
- 真实首条 prompt 持久化后立即写清洗后的 40 字节 fallback；标题请求的 JSON 文本最多 4KB，单轮无工具、64 token，模型结果清洗后最多 80 字节。独立请求不进入主 Transcript、hooks 或 Run usage，主 Run 不等待模型标题。
- `titleModel` 支持用户设置和项目覆盖；默认读取当前主模型。子代理及 fork 直接使用完整委派描述；手动标题也保留完整名称。
- `rename()` 可在空闲、Run 和手动压缩期间调用；中止待完成的标题请求，晚到结果不能覆盖用户来源。对话回退后保留 native 标题及对应来源；来源未变化时保持既有回退分支锚点。
- TUI `/rename` 支持无参数预填并把光标放在末尾；OSC 0 输出空闲 `✦ 标题`，运行中使用 spinner。Headless 同样持久化自动标题。
- 测试边界为标题调用提供独立响应/控制队列；除 `fakeModel`、`controlledModel` 外，已有直接 streamFn 计数器/等待门及 CLI 假 HTTP 服务端也单独路由标题请求，避免消耗主响应。新增的 Session 存储队列串行协调标题、plan、model 与 Run/手动压缩的打开和关闭；模型等待在队列外。

验证：

- 标题 Core 15 项公开行为测试通过，包含 UTF-8 边界、独立调用、一次生成、失败、项目模型、子/fork、手动固定、回退、并发改名/模型、Run 中断、压缩和长名称。
- `8a49d57` 上执行完整 `env -u NO_COLOR bun run check`：静态检查通过，1608 pass / 1 fail；唯一失败为既有回退锚点断言，已在 `3c68f87` 修复。
- 08 合并后重新验证标题、checkpoint、Run、model、compaction/hooks、TUI title/model/settings/slash、Headless：106 pass / 0 fail，566 assertions；`oxfmt --check`、`oxlint`、`tsc -b`、`knip` 全部通过。
- 整个 spec 的最终 integration HEAD 完整检查由整合交付执行。
