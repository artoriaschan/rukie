# 01: 脚手架与第一条 tracer bullet

**What to build:** 搭起 Bun monorepo，包含 `@neant/shared`、`@neant/agent`、`@neant/cli` 三个包，配齐全套质量闸门，并打通最短的端到端路径：`neant -p "<prompt>"`（不写 `-p` 时从 stdin 读取）→ Agent Core 创建 Session，执行一次 Run（底层是 pi `Agent`，模型由 `streamFn` 提供）→ 输出最终 assistant 文本。这张 ticket 不接真实 provider，模型调用通过注入的 `streamFn` 完成。仓库结构、版本和测试约定见 `CLAUDE.md`、`docs/tech-stack.md` 和 spec 的 "Testing Decisions" 部分。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 三个包按 `CLAUDE.md` 的 Repo layout 建好；内部包不构建，用 `workspace:*` 互相引用；依赖版本按 `docs/tech-stack.md` 精确锁定（typebox 与 pi 的版本一致，用 `bun pm ls` 确认依赖树里只有一份）
- [x] pre-commit hook（husky）执行 lint-staged，对暂存的文件运行 oxfmt 格式化和 `oxlint --fix`
- [x] commit-msg hook 执行 commitlint（`@commitlint/config-conventional`），拒绝不符合规范的提交信息
- [x] knip 配置覆盖所有 workspaces，在当前代码上零告警
- [x] 根目录有一个 `check` 脚本，依次运行 `oxfmt --check`、`oxlint`、`tsc -b`、`knip` 和所有包的测试，任何一步失败都以非 0 退出
- [x] lint 规则禁止 `@neant/shared` 引用 `Bun.*`、`node:*` 和 DOM API
- [x] 手动验证闸门会生效：不规范的提交信息、格式有问题的文件、从 shared 引用 `node:fs`，这三种情况都会被拦下（验证完成后撤销这些改动）
- [x] Agent Core 对外暴露 `createSession(options)` 和 `session.run(prompt, { signal })`；options 至少包含 `cwd`、`homeDir`、`streamFn`
- [x] `neant -p` 和 stdin 两种输入方式都能拿到最终文本输出
- [x] 在 `tests/helpers` 下提供一个按脚本返回结果、并记录收到的上下文的假 `streamFn`
- [x] 在 `tests/e2e` 下写第一个 Seam 1 测试（假 `streamFn` 加临时目录），验证一次 Run 的完整流程；它作为后续测试的参考范例

## Comments

- 实现说明：`@neant/shared` 暂时没有依赖。typebox 等第一个 schema 进 shared 时再加，否则 knip 会报未使用的依赖；依赖树里只有 pi 带进来的 typebox@1.3.27 一份。
- knip 用零配置，workspaces 从根 `package.json` 自动识别，所以没有 `knip.json`。
- `createSession` 目前要求传入 `model` 和 `streamFn`。真实的 `neant` 命令会输出 "No model configured." 并以 1 退出，直到 02 接入 settings。CLI 的两种输入方式在 `apps/cli/tests/main.test.ts` 里用注入的模型在进程内测试。
- 格式问题：pre-commit 会自动修复，`bun run check` 里的 `oxfmt --check` 负责拦截。
