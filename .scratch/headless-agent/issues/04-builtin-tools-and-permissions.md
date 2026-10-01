# 04: 内置工具与权限

**What to build:** agent 能用 read、write、edit、bash（pi 自带）以及 glob、grep（自己实现）来完成编码任务，并且受权限控制：
- 默认只放开只读的 `read`、`glob`、`grep`（`skill` 工具在 07 加入只读集合）。
- 用户可以用 `--allow-tools <pattern...>`（glob 模式）、settings 里的 `allowTools`，或者 `--yolo` 放开更多工具。
- 没有授权的调用不会执行，而是以 `isError` 告诉模型"该工具未获授权"，同时发出 `permission_denied` 事件。
- 权限判定是一个纯函数，返回 `allow`、`deny` 或 `ask`；headless 模式下 `ask` 按 `deny` 处理。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] glob 基于 `Bun.Glob`，遵守 `.gitignore`
- [ ] grep 调用 `rg`；找不到 `rg` 时，工具返回带安装提示的错误，进程不崩溃
- [ ] bash 有超时；Run 被中止时会终止子进程
- [ ] 工具抛出的异常作为 `isError` 结果返回给模型，不中断 Run
- [ ] 判定挂在 `beforeToolCall` 上；CLI 的模式、settings 的 `allowTools` 和 `--yolo` 三种放开方式都能生效
- [ ] Seam 1 测试覆盖：默认拒绝写类工具和 bash；用 glob 模式放开；yolo 放开全部；被拒时模型收到的错误内容和 `permission_denied` 事件；grep 和 glob 在临时仓库里的结果
