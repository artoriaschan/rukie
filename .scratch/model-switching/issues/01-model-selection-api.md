# 01: Agent Core Model Selection 入口

Status: ready-for-agent

Blocked by: —

**What to build:** 用 `setModelSelection({ model?, thinkingLevel? })` 替换 `setModel`，Session 暴露 `thinkingLevel`。见 spec「Agent Core」。

- 档位按“只往低档降”的规则计算，一次 configure 同时写入模型和档位；返回实际生效的 `{ model, thinkingLevel, clampedFrom? }`。
- `modelState` 升到 v2 `{ model, thinkingLevel }`，兼容 v1；Rewind 和 resume 恢复两者。确认 Rewind 后原生 configure 与 Tool State 一致，只保留一个状态来源。
- 现有 TUI `switchModel` 和 `/model <spec>` 改调新入口，行为不变；删除 `setModel`。

- [ ] e2e：只改模型、只改档位、两者同时改；请求携带的 thinking 参数与返回值一致
- [ ] e2e：降档、无更低档时取最低档、`reasoning: false` 时为 off
- [ ] e2e：Run 中调用报错、并发切换报错、凭据缺失报 `no-api-key`
- [ ] e2e：Rewind 到切换前恢复旧选择；resume 恢复保存的选择，不受 `settings.thinking` 影响；v1 modelState 正常读取
- [ ] 现有 `model-switch.test.ts`、`image-model-notice.test.ts` 通过
