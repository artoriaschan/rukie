# 01: 对话界面按四层重组（预重构）

**What to build:** 把 `neant` 的对话界面从"一个文件装所有东西"重组成 spec 定义的 ③ 应用组件 + ④ 屏幕结构，视觉和行为完全不变。会话状态（事件归约、resume 回放、session 订阅）和权限队列迁入 chat 屏幕作为私有状态；展示拆成按 UI 区域划分的组件目录（logo 先留空位或省略、user-message、assistant-message、tool-call、notice、permission-dialog、prompt-input、status-line），统一由 components 入口收口，组件只接收 props，不接触 Session。旧的 conversation / permissions 目录删除。见 `.scratch/tui-style/spec.md` 的 ③ ④ 两节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] chat 屏幕持有会话 store 与权限队列，入口渲染 chat 屏幕
- [ ] 每个 UI 区域一个目录并经各自 `index.ts` 暴露，components 入口统一导出
- [ ] ③ 层组件不 import `@neant/agent`
- [ ] 旧 conversation / permissions 目录已删除，无残留引用
- [ ] 现有 neant-tui 测试全部通过（只改 import 路径），`bun run check` 全绿
- [ ] 手动运行 `neant`，界面输出与重组前一致
