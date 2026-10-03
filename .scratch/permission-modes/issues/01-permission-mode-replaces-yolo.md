# 01: 用 Permission Mode 取代 yolo（ask / full-access）

Status: resolved

**What to build:** 用户可以通过 settings 的 `permissionMode`、CLI/TUI 的 `--permission-mode` 选择 `ask` / `auto-review` / `full-access`，`--yolo` 是 `full-access` 的别名；运行中调用 session 的 `setPermissionMode` 后，下一个工具调用即按新模式判定。本单 `auto-review` 暂按 `ask` 判定（评审在 03 实现）。见 spec Implementation Decisions 的 permissions / session / settings / Headless CLI 节。

**Blocked by:** None (can start immediately)

- [x] `SessionOptions.yolo` 删除，`permissionMode` 取代；默认 `ask`
- [x] `ask`：只读工具 allow，命中 `allowTools` allow，其余 ask（与现状一致）
- [x] `full-access`：所有工具 allow
- [x] session 暴露 `setPermissionMode` 与读取当前 mode；run 中途切换对下一个工具调用生效
- [x] settings 支持 `permissionMode`、`reviewModel`；项目级 `permissionMode` 丢弃并警告，`reviewModel` 可被项目覆盖
- [x] Headless CLI 与 TUI 支持 `--permission-mode`；`--yolo` 等价 `full-access`；两者冲突报参数错误
- [x] session e2e、config、CLI 参数测试覆盖以上行为

## Comments

2026-10-03：完成。`Session.permissionMode` 提供当前模式，`setPermissionMode` 只修改 session 内存；初始化优先级为 SessionOptions → 用户 settings → `ask`。运行中切换与 resume 重置已通过行为测试。`auto-review` 在本单仍按 `ask` 判定，Permission Review 和 TUI 模式切换继续由 03 / 02 负责。

验证：关键行为先 red 后 green；定向 session / config / Headless CLI / TUI 测试及阶段性 `bunx tsc -b` 通过。最终 `rtk proxy env -u NO_COLOR bun run check` 通过格式、Lint、类型检查、Knip 及全部 418 项测试（0 fail）。

### Standards

未发现仓库规范违规。共享类型保持运行时无关并被多个包使用；Agent Core 维持概念目录和公开入口；测试使用 Bun 并放在约定目录。

可选建议：Headless CLI 与 TUI 重复了 mode 校验、`--yolo` 冲突检查和别名解析，可考虑共享纯函数。本次沿用仓库现有的各 frontend 参数解析结构，暂不抽取。

### Spec

未发现缺项、错误行为或范围扩张。本单的三模式基础判定、运行中切换、settings 边界与 frontend 参数行为均已覆盖；`auto-review` 暂按 `ask` 符合票据限定。

审查结果：Standards 0 项规范违规、1 项可选去重建议；Spec 0 项问题。
