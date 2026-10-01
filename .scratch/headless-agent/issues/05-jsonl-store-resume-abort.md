# 05: JSONL 存储、resume 与中断

**What to build:** 每次 Run 都自动把 Session 写成 JSONL 文件（使用 pi 的 `JsonlSessionRepo` 和 v3 格式，只用线性结构），存放在 `~/.neant/sessions/<项目路径 slug>/` 下。用户可以用 `--resume <id>` 在原 Session 上继续提问，resume 后模型看到的上下文和当时一致；id 不存在时明确报错。Ctrl-C 会中止 Run，已经产生的消息都会写入存储，然后以 130 退出。Session Store 作为 `createSession` 的一个可替换参数，为以后的 SQLite 实现留好位置（ADR-0003）。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `createSession` 支持传入 `store` 和 `resumeId`；headless 模式默认使用 JSONL 存储
- [ ] `--resume <id>` 能继续对话；id 不存在时报错，退出码为 1
- [ ] 收到 SIGINT 时中止 Run，等消息都写完再以 130 退出
- [ ] Seam 1 测试覆盖：写入后 resume，模型收到的上下文前缀与之前完全一致；abort 之后已产生的消息不丢失
- [ ] Seam 2 测试覆盖 `--resume`
