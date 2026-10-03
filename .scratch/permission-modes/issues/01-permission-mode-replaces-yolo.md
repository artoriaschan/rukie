# 01: 用 Permission Mode 取代 yolo（ask / full-access）

Status: ready-for-agent

**What to build:** 用户可以通过 settings 的 `permissionMode`、CLI/TUI 的 `--permission-mode` 选择 `ask` / `auto-review` / `full-access`，`--yolo` 是 `full-access` 的别名；运行中调用 session 的 `setPermissionMode` 后，下一个工具调用即按新模式判定。本单 `auto-review` 暂按 `ask` 判定（评审在 03 实现）。见 spec Implementation Decisions 的 permissions / session / settings / Headless CLI 节。

**Blocked by:** None (can start immediately)

- [ ] `SessionOptions.yolo` 删除，`permissionMode` 取代；默认 `ask`
- [ ] `ask`：只读工具 allow，命中 `allowTools` allow，其余 ask（与现状一致）
- [ ] `full-access`：所有工具 allow
- [ ] session 暴露 `setPermissionMode` 与读取当前 mode；run 中途切换对下一个工具调用生效
- [ ] settings 支持 `permissionMode`、`reviewModel`；项目级 `permissionMode` 丢弃并警告，`reviewModel` 可被项目覆盖
- [ ] Headless CLI 与 TUI 支持 `--permission-mode`；`--yolo` 等价 `full-access`；两者冲突报参数错误
- [ ] session e2e、config、CLI 参数测试覆盖以上行为
