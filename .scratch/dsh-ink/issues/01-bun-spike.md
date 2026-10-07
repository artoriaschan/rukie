# 01: Spike：dsh ink 在 Bun 与 headless 测试下运行

Status: ready-for-agent
Blocked by: None (requires package-merge resolved)
Type: prototype

**Question:** dsh-TUI `3c89ea51` 的 ink 能否在 Bun 下渲染 Rukie 的最小屏幕，并通过注入的 xterm headless 终端测试？替换成本多大？见 [spec](../spec.md)。

- [ ] 在临时分支或目录中搬入 dsh ink 与 Yoga，桩掉 dsh 内部依赖，跑通 Box、Text、ScrollBox、useInput 组成的全屏屏幕
- [ ] 确认在 Bun 下可用或需要替代：`worker_threads`（sixel）、`process.*` 默认流、`NodeJS.WriteStream` 的类型与行为
- [ ] 用 xterm headless 注入 stdin/stdout，写一个帧断言测试并通过
- [ ] 列出需要的 npm 依赖、需要的桩及其行数，以及 Rukie design-system 改接时的 API 差异（ScrollBox 句柄、input 事件结构、图片协议）
- [ ] 估计应用层与测试的改写量，拆出实施工单
- [ ] 在 Answer 写结论：可行时把 ADR-0013 改为 accepted 并将 ADR-0005 标记为 superseded；不可行时把 ADR-0013 改为 rejected 并写明原因
