# 01: 渲染器鼠标 hover

Status: resolved

**What to build:** 在 `@neant/tui` 补齐 hover 能力，见 spec ① 节。

- 全屏模式额外开启 1002 和 1003 鼠标追踪，退出时关闭。
- 解析器把不带按键的 motion 解析为 `{ type: "move", x, y }`。
- 每帧记录节点的屏幕矩形，`Box` 增加 `onMouseEnter` / `onMouseLeave`：
  - 命中集合取命中节点及其祖先链上带 hover 回调的节点；
  - 与上次的集合做差，先派发 leave，再派发 enter；
  - 鼠标在同一格内不重复派发；
  - resize 时清空命中集合。

**Blocked by:** —

- [x] 进入和退出全屏时写出 1002/1003 的开关序列
- [x] 嵌套 Box 的 enter/leave 派发顺序正确，鼠标移出所有节点时派发 leave
- [x] 同一格的 motion 不重复派发
- [x] wheel 滚动的现有测试保持通过
- [x] 拷贝的代码在文件头注明来源 dsh-TUI（本次独立实现，没有拷贝代码）
- [x] `bun run check` 全绿

## Answer

`Box` 新增 `onMouseEnter()` / `onMouseLeave()`。每帧保存屏幕矩形及带 hover 回调的祖先集合，按最内层命中节点计算 hover 集合，先 leave 后 enter；支持 ScrollBox 偏移和裁剪，同格 motion 去重。resize 派发 leave 并清空集合和坐标，下一帧后可重新进入。

全屏开启 1002/1003，正常退出、信号和绘制失败均通过原有清理路径关闭。SGR 无按键 motion 输出零基坐标的 `move` 事件，wheel 不变。TextInput 与 Chat 忽略 motion，避免影响编辑和连续 Ctrl+C 退出。遵循 ADR-0005 独立实现，未复制 dsh-TUI 源码。

验证：`rtk proxy env -u NO_COLOR bun test packages/tui/tests/renderer/hover.test.tsx`（5 pass）；`rtk proxy env -u NO_COLOR bun run check`（格式、lint、类型、Knip 及全量 313 tests 全通过）。运行环境默认设置 `NO_COLOR=1`，验证时清除以覆盖颜色输出；专门的 NO_COLOR 用例仍保留并通过。

审查：Standards 0 项；Spec 发现祖先链在 React 提交后、绘制前会变化的问题，已通过逐帧保存祖先集合修复，增加了先失败后通过的公开接缝回归测试，复审后剩余 0 项。
