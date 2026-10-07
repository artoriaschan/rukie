# 01: 三个包原样搬入 packages/coding-agent

Status: ready-for-agent
Blocked by: None (can start immediately)

**What to build:** 新建 `packages/coding-agent`，把 `apps/neant-cli` 搬到 `src/headless/`、`apps/neant-tui` 搬到 `src/tui/`、`packages/tui` 搬到 `src/ink/`（`components` 改名 `primitives`），测试按同样结构搬入 `tests/`。对 `@neant/tui` 的引用改为指向 `ink/index.ts` 的相对路径。删除 `apps/`。两个 bin 暂时保留，行为不变。见 [spec](../spec.md)。

- [ ] `packages/coding-agent` 的 package.json 依赖为三个包的并集，版本不变；workspaces、tsconfig references、bun.lock 已更新
- [ ] `ink/` 不依赖 agent、i18n 和上层目录，`tui/` 只经 `ink/index.ts` 导入，包内不自引用；Agent Core 规则改为禁止导入 `@neant/coding-agent`；各规则做过负向验证
- [ ] Knip、Oxlint、ADR-0005、renderer README 中的 Yoga 路径已更新
- [ ] README 移到 `src/ink/README.md` 与 `src/tui/README.md`；`ink/README.md` 开头说明当前为自研实现，不是 Ink 的 fork
- [ ] `dev`、`test:coding-agent` 脚本指向新路径；AGENTS.md、architecture.md、tech-stack.md、mcp.md、permission-rules.md、brand/design.md、ADR-0006/0011、`packages/coding-agent/src/ink/design-system/color.ts` 注释中的路径已更新
- [ ] 未关闭的 `.scratch` 工单与 spec 路径已更新；issue-tracker.md 写明 resolved 记录中的路径以当时的提交为准
- [ ] `env -u NO_COLOR bun run check` 通过，测试数与搬迁前一致
