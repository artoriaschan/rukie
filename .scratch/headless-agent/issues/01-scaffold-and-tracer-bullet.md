# 01: 脚手架与第一条 tracer bullet

**What to build:** 搭起 Bun monorepo，包含 `@neant/shared`、`@neant/agent`、`@neant/cli` 三个包，配齐全套质量闸门，并打通最短的端到端路径：`neant -p "<prompt>"`（不写 `-p` 时从 stdin 读取）→ Agent Core 创建 Session，执行一次 Run（底层是 pi `Agent`，模型由 `streamFn` 提供）→ 输出最终 assistant 文本。这张 ticket 不接真实 provider，模型调用通过注入的 `streamFn` 完成。仓库结构、版本和测试约定见 `CLAUDE.md`、`docs/tech-stack.md` 和 spec 的 "Testing Decisions" 部分。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 三个包按 `CLAUDE.md` 的 Repo layout 建好；内部包不构建，用 `workspace:*` 互相引用；依赖版本按 `docs/tech-stack.md` 精确锁定（typebox 与 pi 的版本一致，用 `bun pm ls` 确认依赖树里只有一份）
- [ ] pre-commit hook（husky）执行 lint-staged，对暂存的文件运行 oxfmt 格式化和 `oxlint --fix`
- [ ] commit-msg hook 执行 commitlint（`@commitlint/config-conventional`），拒绝不符合规范的提交信息
- [ ] knip 配置覆盖所有 workspaces，在当前代码上零告警
- [ ] 根目录有一个 `check` 脚本，依次运行 `oxfmt --check`、`oxlint`、`tsc -b`、`knip` 和所有包的测试，任何一步失败都以非 0 退出
- [ ] lint 规则禁止 `@neant/shared` 引用 `Bun.*`、`node:*` 和 DOM API
- [ ] 手动验证闸门会生效：不规范的提交信息、格式有问题的文件、从 shared 引用 `node:fs`，这三种情况都会被拦下（验证完成后撤销这些改动）
- [ ] Agent Core 对外暴露 `createSession(options)` 和 `session.run(prompt, { signal })`；options 至少包含 `cwd`、`homeDir`、`streamFn`
- [ ] `neant -p` 和 stdin 两种输入方式都能拿到最终文本输出
- [ ] 在 `tests/helpers` 下提供一个按脚本返回结果、并记录收到的上下文的假 `streamFn`
- [ ] 在 `tests/e2e` 下写第一个 Seam 1 测试（假 `streamFn` 加临时目录），验证一次 Run 的完整流程；它作为后续测试的参考范例
