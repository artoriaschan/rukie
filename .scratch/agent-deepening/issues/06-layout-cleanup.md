# 06: 目录整理

**What to build:** `tools/` 根目录共享运行时支撑移入 `tools/support/` 并同步 `.oxlintrc.json`；`prompt/` 并入 `session/prompt.ts`。详见 [spec](../spec.md)。

Blocked by: 04, 05

Status: ready-for-agent

- [ ] 导入限制规则仍拒绝能力执行模块导入运行时适配层
- [ ] `bun run check:dev` 通过
