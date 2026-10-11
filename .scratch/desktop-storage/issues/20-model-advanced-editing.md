# 20: 高级设置表单可编辑

Status: ready-for-agent

Blocked by: 19

用户截图报告模型高级设置表单无法填写。通过真实 React DOM 输入复现自动压缩阈值、Temperature、最大工具迭代次数、四项价格与价格来源等字段，查明 disabled/readOnly/状态接线及现有保存和执行能力。保留当前 C16、beUI Input、布局和字段，不增加设计不存在的选项。用户要求可填写，不能用静默丢弃或假保存实现。

- [ ] 最小公开浏览器场景复现不能填写的根因，覆盖受影响字段
- [ ] 修复编辑与保存/重开；涉及尚未支持的参数时定位拥有者，补齐必要合同及执行接线或明确阻塞，不能仅移除 disabled
- [ ] 同步受影响消费者、契约和必要说明，保留模型兼容信息
- [ ] 验证单一 owner：focused case及相关静态，一次 Chromium/mock Light/Dark/窄屏，复用有效证据
- [ ] 新两轴审查、fresh merger 快进集成、ticket/spec 关闭

遵守 docs/testing 验证增量与原生授权边界：不运行真实 Electron/Keychain，不跑包级/全量/CI，不读取用户凭证/Session，不改变其他界面布局。
