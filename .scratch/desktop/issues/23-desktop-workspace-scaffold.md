# 23: ui、server、desktop 三包骨架与本地测试接入

**What to build:** 建立三个 workspace 包与它们的检查链：`@rukie/shared` 中的 wire 命令 schema 骨架、ui 五层目录与 lint 边界、Vitest 接入与 runner 边界、字号 lint。见 [spec](../spec.md) 的「包结构」「Testing Decisions」与 [ADR-0029](../../../docs/adr/0029-desktop-package-structure.md)。

Blocked by: None (can start immediately)

Status: ready-for-agent

- [ ] `packages/ui`、`packages/server`、`packages/desktop` 以 `workspace:*` 互相引用，`tsc -b`、`knip` 通过
- [ ] `.oxlintrc.json` 按目录强制 ui 五层依赖方向，以及 ui 禁止值导入 `@rukie/agent`、禁止 `@rukie/coding-agent`、`electron`、`node:*`、`bun`、`bun:*`；各有一条违规样例被拦截
- [ ] 根 `bunfig.toml` 用 `pathIgnorePatterns` 排除 ui 与 desktop，`bun test`、`--parallel`、`--shard` 都不收集 Vitest 文件
- [ ] `test:desktop` 运行 ui（browser mode + Node 环境）与 desktop（Node）各一个示例测试，只加入本地 `check`，不加入 `check:dev`
- [ ] `check:test-policy` 新增 runner 边界规则并有回归样例
- [ ] `scripts/check-*.ts` 禁止 ui 中非 `text-ui-*` 的字号类与内联 `fontSize`，接入 `check:dev`
- [ ] 依赖精确锁定，`docs/tech-stack.md` 与 lockfile 同步（vitest 5.0.3 等）；AGENTS.md 与 `docs/testing.md` 写明 ui/desktop PR 须附本地 `test:desktop` 证据与 `playwright install --only-shell chromium` 前置步骤
