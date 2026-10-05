# 05: `/model` 切换

**What to build:** 用户在 TUI 输入 `/model` 打开模型选择器，或 `/model provider/id` 直接切换；从下一次模型调用起使用新模型，resume 后保持，不改 `settings.json`。见 [spec](../spec.md) 的“模型切换”。

**Blocked by:** 01（命令框架与补全菜单）

**Status:** ready-for-agent

- [ ] Agent Core 导出可用模型清单：settings 自定义模型 + 内置 provider 模型
- [ ] Session 新增 `setModel(spec)`：仅空闲；经现有模型解析，失败抛错且当前模型不变
- [ ] 选择以 Tool State `model` 持久化，resume 时优先于 settings 的 `model`；不写 `settings.json`
- [ ] 沿用父模型的子代理自下一个新建者起使用新模型，已在跑的不变
- [ ] TUI：无参数打开选择器（复用现有选择组件，当前模型标注），有参数直接切换；状态栏同步；run 中被拒；错误以通知显示
- [ ] Agent Core e2e（下一次调用模型、resume 恢复、错误名、子代理）与 TUI 测试覆盖以上行为
