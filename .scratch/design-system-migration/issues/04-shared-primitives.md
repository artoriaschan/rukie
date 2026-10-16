# 04：共享原语的几何、变体与交互状态

Status: ready-for-agent
Blocked by: 01, 02

**What to build:** 把 Button、Input、Select、Textarea、Switch、Checkbox、Radio、dropdown/context 菜单、Popover、Tooltip 和 MorphingModal 迁移到 DESIGN.md 的 Shared control targets 和 Radius 规则，补全 ticket 01 定义的变体，并更新所有调用点。见 [spec](../spec.md) 的「共享原语」一节。

## 授权差异（实施前补全，逐项列出受影响的消费者）

| 原语                                    | 属性                         | 旧值                          | 新值                                         |
| --------------------------------------- | ---------------------------- | ----------------------------- | -------------------------------------------- |
| Button `lg` / `standard`                | 内边距、字号、圆角           | 12px、14/21、8px              | 16px、14/20、12px                            |
| Button `md` / `compact`                 | 内边距、字号、圆角           | 10px、14/21、8px              | 12px、12/16、12px                            |
| Button `sm` / `contextual`              | 内边距、字号、圆角           | 8px、13/19.5、6px             | 8px、ticket 01 的字号与圆角                  |
| Input（`motion/input.tsx`）             | 最小高度、内边距、字号、圆角 | 32px、—、14/21、8px           | 36px、上下 4px 左右 12px、12/16、12px        |
| Select trigger                          | 最小高度、内边距、圆角       | 32px、上下 4px 左右 12px、8px | 36px、上下 8px 左右 12px、12px               |
| Select 面板、dropdown 与 context 菜单壳 | 圆角                         | 8px                           | 12px（内边距保持 4px，行间距保持 2px）       |
| 菜单行                                  | 圆角、字号                   | 6px、14/21                    | ticket 01 的行圆角、14/20                    |
| Session 菜单行                          | 最小高度、字号               | 32px、14/21                   | 26px、13/18（显式紧凑变体）                  |
| MorphingModal                           | 内边距                       | 外层 16px，部分页面另加 8px   | 原语统一 24px，窄窗口水平 16px，页面不再另加 |
| 重命名 Dialog                           | 最大宽、标题                 | 480px、16px lg                | 384px、18/18 medium                          |

## 任务

- [ ] Button 增加语义变体 `standard`、`compact`、`contextual`、`micro`、`icon`，不改变 `sm`/`md`/`lg` 的高度含义。逐个审查 117 个 `<Button>` 调用点，为每个显式选择变体：普通操作和对话框底栏用 `standard`，工具栏和紧凑场景按规范选择。在 Comments 中记录调用点清单和选择理由。
- [ ] Input、Select、Textarea（`agents/prompt-input.tsx` 除外，composer 是规范点名的几何）、Switch（包括 provider 的 32×18 变体）、Checkbox 和 Radio 按目标表实现。错误提示与对应字段保持关联。
- [ ] 菜单：dropdown、context 和 Select 面板统一壳与行的 token。Session 菜单的入口改用紧凑变体。菜单出现和消失都是即时的，不带退出动画。
- [ ] 覆盖层：Popover、Tooltip 和 MorphingModal 接入 ticket 02 的覆盖层阴影角色。MorphingModal 的标题和底栏固定可见，正文滚动，在视口内钳制为宽高各减 32px。
- [ ] 删除页面对原语内部元素的覆盖，改用原语变体：
  - `.project-dialog > div` 的内边距、`.project-dialog button … > svg`。
  - `.app-titlebar-navigation button` 的尺寸和焦点样式。
  - 各页面对 MorphingModal 内容额外加的 `p-2`。
- [ ] 交互状态：hover 只改变指向的目标，不改变几何；按下不加额外反馈；禁用为 50% 不透明度，并同时阻止指针和键盘；焦点为 2px，不被裁切，并且独立于 hover。光标按 Web PC interaction 表实现，嵌套的图标和标签继承光标。
- [ ] 规范点名的功能尺寸保持不变：Project 对话框 480/416/520/448px，以及其中的 32px 字段和 36px 主操作；设置页字段；Goal 和 worktree 的局部对话框；模型选择器；搜索面板；composer。这些位置如果原来依赖共享默认值，要改为显式使用局部变体，确保它们的几何不变。
- [ ] 测试：
  - 在 `compact-foundation`、`compact-overlays`、`compact-center-modal`、`f01-controls`、`select`、`input-focus`、`press-feedback`、`instant-interactions` 中，按上表更新断言并补齐新变体。
  - 功能套件中规范点名的尺寸断言保持不变。
  - 覆盖 14px 与 18px 界面字号、420px 宽度、计算光标，以及禁用目标拒绝指针和键盘。
  - 运行一次 `bun run test:desktop`。
- [ ] 运行 `bun run check:dev`。用 agent-browser 验收：在 Light、Dark 和窄宽度下检查对话框、菜单、Select、设置表单和 Session 菜单，检查控制台与网络。

## Comments
