# 05: JSONL 存储、resume 与中断

**What to build:** 每次 Run 都自动把 Session 写成 JSONL 文件（使用 pi 的 `JsonlSessionRepo` 和原生 v4 格式，只用线性结构），存放在 `~/.neant/sessions/<项目路径 slug>/` 下。用户可以用 `--resume <id>` 在原 Session 上继续提问，resume 后模型看到的上下文和当时一致；id 不存在时明确报错。Ctrl-C 会中止 Run，已经产生的消息都会写入存储，然后以 130 退出。Session Store 作为 `createSession` 的一个可替换参数，为以后的 SQLite 实现留好位置（ADR-0003）。

**Blocked by:** 02

**Status:** resolved

- [x] `createSession` 支持传入 `store` 和 `resumeId`；headless 模式默认使用 JSONL 存储
- [x] `--resume <id>` 能继续对话；id 不存在时报错，退出码为 1
- [x] 收到 SIGINT 时中止 Run，等消息都写完再以 130 退出
- [x] Seam 1 测试覆盖：写入后 resume，模型收到的上下文前缀与之前完全一致；abort 之后已产生的消息不丢失
- [x] Seam 2 测试覆盖 `--resume`

## Comments

- 2026-10-01：经用户确认，采用锁定的 pi-agent-core 0.99.2 `JsonlSessionRepo` 原生 v4 格式；同步 ADR-0003 和 spec 的文件命名约定，slug 和带时间戳的文件名由 pi 生成。
- `SessionStore` 使用 pi repo 的 `create`、`open`、`list` 接口；默认 JSONL，测试也通过真实 `MemorySessionRepo` 验证替换。`session.id` 可用于恢复；所有消息只追加到 `main` 分支。
- `message_end` 的异步监听器等待消息落盘；存储使用不随 Run 取消的 context。Run 完成、失败或中断时都关闭存储 Session，不关闭调用方提供的 repo。
- Seam 1 验证完整上下文前缀（包括 reminder 原文与消息时间戳）和中断后的部分输出；Seam 2 验证跨进程 resume、未知 id、SIGINT 退出 130，以及等待 stdin 时的取消和正常管道输入。
- 验证：`bun run check` 通过（格式、lint、`tsc -b`、knip、全量 31 个测试）；规范审查和规格审查各 0 项剩余问题。
