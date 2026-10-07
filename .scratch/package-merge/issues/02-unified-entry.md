# 02: 统一入口与参数

Status: ready-for-agent
Blocked by: 01

**What to build:** 新建 `src/main.ts` 和 `src/cli/`，用一份参数表解析并校验，然后按模式动态 import `headless/` 或 `tui/`。用法对齐 Claude Code。删除 `neant-cli` bin、`dev:cli` 和 `dev:tui`。见 [spec](../spec.md) 的"模式判定"。

- [ ] `neant` 进入 TUI，`neant "q"` 进入 TUI 并发送首条 prompt
- [ ] `neant -p "q"` 和 `echo q | neant -p` 走 Headless，输出、退出码与 stream-json 行为与原 Headless CLI 一致
- [ ] `--goal` 走 Headless；`--goal` 与 `-p` 的冲突、`--max-goal-rounds` 校验保持原语义
- [ ] 不带 `-p` 且 stdin 非 TTY 时退出码 2，并提示使用 `-p`
- [ ] TUI 模式下用 `--output-format`、`--max-goal-rounds` 报参数错误
- [ ] 参数错误按 locale 显示，zh 与 en 文案同步；删除 CLI 原有的英文常量
- [ ] `-p` 模式不加载 `ink/` 和 react，有测试证明；`main.ts` 与 `cli/` 不静态导入 `tui/`、`ink/` 的 lint 规则做过负向验证
- [ ] package.json 只有一个 bin `neant`；`src/index.ts` 导出 `main` 和 IO 类型；AGENTS.md、architecture.md 中的命令示例已更新
- [ ] `env -u NO_COLOR bun run check` 通过
