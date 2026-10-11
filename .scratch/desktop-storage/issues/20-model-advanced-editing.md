# 20: 高级设置表单可编辑

Status: claimed

Blocked by: 19

用户截图报告模型高级设置表单无法填写。通过真实 React DOM 输入复现自动压缩阈值、Temperature、最大工具迭代次数、四项价格与价格来源等字段，查明 disabled/readOnly/状态接线及现有保存和执行能力。保留当前 C16、beUI Input、布局和字段，不增加设计不存在的选项。用户要求可填写，不能用静默丢弃或假保存实现。

- [ ] 最小公开浏览器场景复现不能填写的根因，覆盖受影响字段
- [ ] 修复编辑与保存/重开；涉及尚未支持的参数时定位拥有者，补齐必要合同及执行接线或明确阻塞，不能仅移除 disabled
- [ ] 同步受影响消费者、契约和必要说明，保留模型兼容信息
- [ ] 验证单一 owner：focused case及相关静态，一次 Chromium/mock Light/Dark/窄屏，复用有效证据
- [ ] 新两轴审查、fresh merger 快进集成、ticket/spec 关闭

遵守 docs/testing 验证增量与原生授权边界：不运行真实 Electron/Keychain，不跑包级/全量/CI，不读取用户凭证/Session，不改变其他界面布局。

实现已完成，等待 fresh merger 快进集成及父代理同步关闭 spec。当前保留 C16 结构与 beUI Input，已有字段可键盘输入小数、保存并重开；可选字段落应用数据库，留空沿用默认策略。Temperature/价格接原生请求和 cost，压缩阈值按用户选定百分比，工具上限按一次 Run 整批工具轮次后无工具总结；恶意响应继续发工具时原生 abort，不执行额外工具。

验证记录由实施代理维护于 `/tmp/rukie-advanced20-evidence/verification.md`：UI focused case（包含实际键盘输入）通过 1.89s；存储冷重开与非法范围拒绝 case 11.93ms；实际 Core/provider 4 cases 487ms，覆盖无工具总结、新 Run/冷恢复、违规响应安全终止及 10/99/100% 原生压缩与独立摘要预算。Light/Dark/420px mock Chromium 验收通过；9 字段可编辑且 cursor:text，保存重开保留，资源请求均 200，无运行时错误。旧包级证据复用，无整套、真实 Electron、Keychain 或 CI。

限制：锁定 Harness 压缩策略归根 Session，子代理沿用根策略；子模型不同压缩阈值不独立生效。同一 Run 的 partial 中断恢复依赖未投影原生提交与 stopReason=toolUse 筛选，已源码审查，未另跑进程 crash 验收。
