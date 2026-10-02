# 01: 渲染器鼠标 hover

Status: ready-for-agent

**What to build:** 在 `@neant/tui` 补齐 hover 能力，见 spec ① 节。

- 全屏模式额外开启 1002 和 1003 鼠标追踪，退出时关闭。
- 解析器把不带按键的 motion 解析为 `{ type: "move", x, y }`。
- 每帧记录节点的屏幕矩形，`Box` 增加 `onMouseEnter` / `onMouseLeave`：
  - 命中集合取命中节点及其祖先链上带 hover 回调的节点；
  - 与上次的集合做差，先派发 leave，再派发 enter；
  - 鼠标在同一格内不重复派发；
  - resize 时清空命中集合。

**Blocked by:** —

- [ ] 进入和退出全屏时写出 1002/1003 的开关序列
- [ ] 嵌套 Box 的 enter/leave 派发顺序正确，鼠标移出所有节点时派发 leave
- [ ] 同一格的 motion 不重复派发
- [ ] wheel 滚动的现有测试保持通过
- [ ] 拷贝的代码在文件头注明来源 dsh-TUI
- [ ] `bun run check` 全绿
