# 06: `neant` tracer bullet：在一个 session 里连续对话

**What to build:** 新建 `@neant/neant-tui`，命令是 `neant`。用户运行 `neant` 后看到输入框，输入 prompt 后看到助手回复流式出现，回复完成后进入 scrollback，可以接着输入下一条，同一个 session 里连续对话。可以中断 run，也可以退出。

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] 新增 `@neant/neant-tui` 包，bin 为 `neant`；加入根 tsconfig 的 references，CLAUDE.md 的目录说明补上这个包
- [ ] 入口写成 `main(argv, io)`，`io` 里注入 stdin、stdout、stderr 和 session 覆盖项，和 `neant-cli` 的形式一致
- [ ] 参数：`--model`、`--thinking`、`--resume`、`--allow-tools`、`--yolo`、`--trust-project-mcp`，以及可选的一个位置参数作为第一条 prompt（自动发出）；参数错误时退出码为 2
- [ ] settings 有问题或缺少模型时，按 `neant-cli` 的文案报错，以 1 退出，不进入渲染
- [ ] 视图状态由 `SessionEvent` 驱动；用户消息和助手文本完成后进入 `Static`；助手文本按原样显示
- [ ] 状态栏显示模型名和本次 run 的 input/output token 数
- [ ] 按键：run 进行中 Esc 或 Ctrl+C 中断，已经产生的消息保留；run 进行中可以编辑，但 Enter 不提交；空闲时 Ctrl+C 清空输入框，输入框为空时 1 秒内第二次 Ctrl+C 退出；输入框为空时 Ctrl+D 退出；退出码为 0
- [ ] 测试走假终端 seam，驱动 `main(argv, io)` 并注入假 `streamFn`：覆盖连续两轮对话、中断、两种退出方式、位置参数作为 prompt、参数错误
- [ ] `bun run check` 全绿
