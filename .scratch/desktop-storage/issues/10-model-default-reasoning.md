# 10: 默认推理等级可选择、保存并生效

Status: claimed

Blocked by: 09

**What to build:** 用户明确选择补齐模型级默认推理等级。使用既有 beUI Select 还原 C16，保存桌面模型默认值，并在新建 Session 或仅采用模型时生效；显式推理等级优先，恢复保留已保存选择。

- [ ] 对照当前 C16 实现默认等级 Select，与真实可用等级一致
- [ ] 桌面模型配置保存默认值，编辑不丢失已有映射和兼容字段
- [ ] server 将模型默认值接到既有 Session API，显式选择及恢复优先，不改变 TUI/Core 全局默认
- [ ] 最小公开行为 red/green、适用静态检查及 Chromium/mock 验收通过
- [ ] 复用统一验证记录，独立评审与 ADR Coverage 完成后同步关闭 spec；不重复交接测试，不启动 Electron

## Implementation evidence

独立新代理 default_reasoning10_implementation_fresh 在独立 worktree/branch 实施；只读调查代理不复用。验证记录归外部 rukie-default-reasoning-evidence，主代理读取并复用其中已通过结果。当前禁用空 Input、模型 schema 缺字段及 server 新建/切换接线缺口已确认；本票不把外观恢复当作执行生效。
