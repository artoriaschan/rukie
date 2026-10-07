# 08: TUI/Headless 恢复、输出与退出边界

Status: ready-for-agent
Blocked by: 07

## What to build

让同一版本 Frontend 完整消费新 Session 契约与原生 committed events。实现自动恢复、新 Session picker、普通取消/显式子停止的区分、Headless 本请求收束与终态输出。保持现有终端/附件/locale 分层与视图功能。当前基线为已合并的 dsh ink，公开组件/hooks、immutable RGBA、root 退出与本地 diff 约束遵循 [ADR-0013](../../../docs/adr/0013-adopt-dsh-tui-ink.md) 和 [renderer README](../../../packages/coding-agent/src/ink/README.md)。

范围与义务见 [spec](../spec.md)，长期决定见 [ADR-0024](../../../docs/adr/0024-adopt-pi-durable-harness.md)。

## Acceptance Criteria

- [ ] TUI 所选新版 Session 打开后自动恢复未结算工作，先呈现一致 snapshot，再流式更新；列表和预览不发模型请求，旧数据不进入 picker。
- [ ] TUI 正常退出 close 并保留工作，Esc 普通 abort 默认不跨后台；显式子代理停止作用正确。只有后台工作时仍显示可理解活动，不把父 idle 文案当作全部完成。
- [ ] Headless -p 与 --goal 等待请求关联的 child/reporter/后续处理后输出终态并退出；无关任务、历史 child 和长期 anchor 不使命令挂住。
- [ ] stream-json 的 Run 边界与最终请求完成可区别，终态不早于相关结果处理；text 返回处理后的最终回答。事件破坏性变更的所有仓库消费和文档例子同步。
- [ ] Headless 主动 SIGINT/SIGTERM 保留未完成工作，等待资源关闭，退出结果不伪装为成功；再启动 resume 能继续，连续恢复不重复通知。
- [ ] 交互恢复有重新询问、失效旧回复和无 callback 安全默认；父子来源、焦点和排队表现正确。
- [ ] TUI 继续经原生组件/hooks 接入；应用拥有图片解码/缩放/裁切，输入 renderer 的 RGBA 不可变。Session close 与 renderer unmount/waitUntilExit/cleanup 分别等待真实完成，不以终端模式已恢复推断存储已关闭；不重新引入旧 renderer shim。
- [ ] 受影响的宽度/高度/resize、读取位置、bottom follow、coexisting panels、图像与终端恢复有 terminal assertions；无意的视觉和键盘行为变化已排除。

## Testing Decisions

主要 seam 保持 headless main、CLI 子进程和 TUI start/startWithClock/headless terminal；参考 headless main/cli、mixed-session-resume、exit-resume、permissions 和 streaming-burst。子进程验证真实 signal/重启合同并记录必需成本；timer UI 使用现有 startWithClock/Sinon testClock，保留真实 I/O 和 setImmediate 完成信号；terminal helper 的 Unicode grapheme、颜色及 flush 处理继续复用。小终端和 resize 只覆盖相关状态，退出确认及 handoff deadline 在 deadline 前/到时验证，不因重绘或恢复重置已接纳截止时间。

## Verification

尚未实施。执行时追加实际命令、退出码、公开行为证据、focused timing 与未验证范围；不得用文档检查冒充代码验收。

## Comments

2026-10-07：从已确认的 grill-with-docs 决策生成；用户已确认测试入口。依赖票未 resolved 前不开展生产迁移。

2026-10-07 基线刷新：上述 API、时钟和退出义务来自当前 92d17ca1 的 dsh ink 交付结果，本票只适配 durable，不重复 renderer 迁移。
