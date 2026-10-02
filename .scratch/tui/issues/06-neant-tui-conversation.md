# 06: `neant` tracer bullet：在一个 session 里连续对话

**What to build:** 新建 `@neant/neant-tui`，命令是 `neant`。用户运行 `neant` 后看到输入框，输入 prompt 后看到助手回复流式出现，回复完成后进入 scrollback，可以接着输入下一条，同一个 session 里连续对话。可以中断 run，也可以退出。

**Blocked by:** 03, 04

**Status:** resolved

- [x] 新增 `@neant/neant-tui` 包，bin 为 `neant`；加入根 tsconfig 的 references，CLAUDE.md 的目录说明补上这个包
- [x] 入口写成 `main(argv, io)`，`io` 里注入 stdin、stdout、stderr 和 session 覆盖项，和 `neant-cli` 的形式一致
- [x] 参数：`--model`、`--thinking`、`--resume`、`--allow-tools`、`--yolo`、`--trust-project-mcp`，以及可选的一个位置参数作为第一条 prompt（自动发出）；参数错误时退出码为 2
- [x] settings 有问题或缺少模型时，按 `neant-cli` 的文案报错，以 1 退出，不进入渲染
- [x] 视图状态由 `SessionEvent` 驱动；用户消息和助手文本完成后进入 `Static`；助手文本按原样显示
- [x] 状态栏显示模型名和本次 run 的 input/output token 数
- [x] 按键：run 进行中 Esc 或 Ctrl+C 中断，已经产生的消息保留；run 进行中可以编辑，但 Enter 不提交；空闲时 Ctrl+C 清空输入框，输入框为空时 1 秒内第二次 Ctrl+C 退出；输入框为空时 Ctrl+D 退出；退出码为 0
- [x] 测试走假终端 seam，驱动 `main(argv, io)` 并注入假 `streamFn`：覆盖连续两轮对话、中断、两种退出方式、位置参数作为 prompt、参数错误
- [x] `bun run check` 全绿

## Comments

- 2026-10-02：新增 `apps/neant-tui`，命令 `neant`，复用 Agent Core 与 `@neant/tui`。事件快照维护用户消息、助手流式原文、完成条目、run 状态与本次 run 的 token 总计；完成消息以稳定 key 写入 `Static`，system reminder 不显示。
- 假终端 seam 新增 26 条测试：连续两轮上下文、流式原文、Esc/Ctrl+C 中断和保留草稿、运行中 Enter 不提交、空闲清空及双 Ctrl+C 的时间窗口、Ctrl+D 退出、终端恢复、位置 prompt、参数错误和启动错误，以及各参数转发、跨 turn usage 累计与 resume 上下文延续。旧对话回显仍由 09 交付。
- code-review：Standards 无发现；Spec 发现 Enter 或 Ctrl+C 后同一个 stdin chunk 的后续字符会复用旧编辑值。两条 red-green 回归验证该问题，渲染器现在同步提交每个输入事件引起的 React 更新，再解码下一事件；ANSI 绘制仍按 16ms 合帧。复审两轴均无剩余发现。
- 最终 `bun run check` 全通过：格式、lint、`tsc -b`、Knip 和全仓库 202 tests / 1022 assertions；其中 frontend 26 tests，终端渲染器 38 tests。
