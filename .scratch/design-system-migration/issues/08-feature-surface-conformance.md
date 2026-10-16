# 08：功能页面逐节符合性与写法清理

Status: ready-for-agent
Blocked by: 03, 04, 05

**What to build:** 按 DESIGN.md 的「Workspace and page composition」各小节，逐页核对已实现页面的几何、token 和交互，清理剩余的字面值和任意值，并加一道静态门禁防止回退。依据 [spec](../spec.md) 中「功能页面」一节。

## 任务

- [ ] 逐节核对以下页面的实测几何，结论写入 Comments，不符合的项按规范修复。

  | 页面                     | 核对项                                                                                |
  | ------------------------ | ------------------------------------------------------------------------------------- |
  | 壳层                     | 52/44/268px、4px 内缩、12px 内角、分隔线、工作区阴影                                  |
  | 导航                     | 透明行、ScrollArea 8/4/24px、头部分隔线                                               |
  | 对话                     | 736/752px、composer 100px 高 / 16px 圆角、滚动条 12/24px、Preview Rail 20/8/6/24/40px |
  | 模型选择器               | 28px 触发器，列表 332px / 32px 行 / 最高 312px，详情 280px，672px 断点                |
  | 权限与上下文面板         | 376px、348px                                                                          |
  | 搜索                     | 520px、20px 壳圆角、31px 结果行、160ms 入场                                           |
  | Project 悬停详情与对话框 | 320px / 12px；480/416/520/448px                                                       |
  | 新聊天选择条             | 40px、288/320px 菜单                                                                  |
  | Worktree                 | 32px 刷新按钮、12px 行、448px 删除对话框                                              |
  | Goal                     | 28px 工具栏、40px 状态条、448px 移除对话框                                            |
  | Plan                     | 44+248px 预览、752px Interaction 卡、300px 摘要、Plan Side Pane 的 960px 断点         |

- [ ] 功能 CSS 中的 hex 字面值改为 token。`components/conversation-controls.css` 有 22 处。`theme.css` 中功能样式部分的字面值也要处理，例如 `.conversation-summary-*`、`.plan-pane*`、`.session-row-title`。
- [ ] 硬编码的 `font-size` 和 `line-height`（例如 `.conversation-summary-*` 中的 `line-height: 1.5`）改为 `text-ui-*` 角色。
- [ ] 分散的 `z-0`、`z-10`、`z-20`、`z-30` 改为层级 token，层级 owner 是 `lib/overlay.ts`。层级顺序为：结构 → 被动提示 → 模态 → 交互菜单。
- [ ] 任意圆角值改为具名角色：
  - `command-palette.tsx` 中的 `rounded-[20px]`：改为搜索壳的具名局部角色。
  - `agent-progress.tsx` 中的 `rounded-[1px]`。
  - 其余 `-[Npx]` 任意值：属于规范点名尺寸的保留，并在 Comments 中写明对应的规范条目；其余改为共享角色。
- [ ] 图标：检查覆盖 Lucide 图标尺寸的写法，例如 `size-4` 写在 svg 上。字形统一为 12px，槽位和点击区是另外的尺寸。
- [ ] GUI 中不显示快捷键提示、keycap 或组合键后缀。逐页检查，搜索框和菜单也包括在内。
- [ ] 把 `scripts/check-ui-typography.ts` 的检查范围扩展到 `packages/ui/src/**/*.css` 中的 `font-size` 字面值（允许引用 `--text-ui-*` 和 `--text-code`），并补充对应的拒绝样本测试。
- [ ] 测试：在各功能 browser 套件中补齐规范点名尺寸的几何断言，覆盖 Light、Dark、420px、18px 字号和 zh/en。运行受影响的文件和 `bun run check:dev`。
- [ ] 用 agent-browser 做最终的整体验收：覆盖上表全部页面，在 Light、Dark 和 420px 下截图，检查控制台与网络。
- [ ] 本 ticket 是 spec 的最后一张。关闭时完成 spec 的 ADR Coverage 审阅，并把 spec 一并设为 resolved。

## Comments
