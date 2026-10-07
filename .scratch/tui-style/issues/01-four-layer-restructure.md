# 01: 对话界面按四层重组（预重构）

**What to build:** 把 `neant` 的对话界面从"一个文件装所有东西"重组成 spec 定义的 ③ 应用组件 + ④ 屏幕结构，视觉和行为完全不变。会话状态（事件归约、resume 回放、session 订阅）和权限队列迁入 chat 屏幕作为私有状态；展示拆成按 UI 区域划分的组件目录（logo 先留空位或省略、user-message、assistant-message、tool-call、notice、permission-dialog、prompt-input、status-line），统一由 components 入口收口，组件只接收 props，不接触 Session。旧的 conversation / permissions 目录删除。见 `.scratch/tui-style/spec.md` 的 ③ ④ 两节。

Blocked by: None (can start immediately)

Status: resolved

- [x] chat 屏幕持有会话 store 与权限队列，入口渲染 chat 屏幕
- [x] 每个 UI 区域一个目录并经各自 `index.ts` 暴露，components 入口统一导出
- [x] ③ 层组件不 import `@neant/agent`
- [x] 旧 conversation / permissions 目录已删除，无残留引用
- [x] 现有 neant-tui 测试全部通过（只改 import 路径），`bun run check` 全绿
- [x] 手动运行 `neant`，界面输出与重组前一致

## Comments

- 2026-10-02：完成预重构。`screens/chat/` 私有模块持有事件归约、resume 回放、Session 订阅和权限队列；`createChat` 封装 Session 与两个 store，只向入口暴露绑定的 Chat、submit 和 stop。旧 `conversation/`、`permissions/` 目录已删除。
- 展示拆为 user-message、assistant-message、tool-call、notice、permission-dialog、prompt-input、status-line 七个区域，各有 `index.ts`，经 `components/index.ts` 收口；只接收 props，不 import `@neant/agent`。logo 按本票允许省略，未引入主题或新字形。消息角色保存在状态中，原有 `>` 前缀移到 UserMessage，输出保持一致。
- 原有 47 个 neant-tui 测试原样通过，无需修改 import 或断言。分组回归涵盖连续提交、流式输出、中断、退出、权限并发与取消、resume、工具和 notice。类型检查在实现后通过；最终 `bun run check` 全绿：格式、lint、`tsc -b`、Knip、全仓库 223 tests / 1166 assertions，0 failures。
- 手动运行前后对照：启动、输入 `visual check`、Ctrl+C 清空、Ctrl+D 退出的 ANSI 输出完全一致。执行工具未提供有效终端尺寸，通过入口 IO seam 显式设置 stdout 为 80×24；使用占位 DEEPSEEK_API_KEY，未提交 prompt 或调用真实模型。
- code-review：以实施前 HEAD `9c55e26e0f70e2d465c13b9633e0994bb6da6090` 为基线，Standards 与 Spec 两路独立审查均无发现。
