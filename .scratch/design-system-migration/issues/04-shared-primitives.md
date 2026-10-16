# 04：共享原语的几何、变体与交互状态

Status: resolved
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

- [x] Button 增加语义变体 `standard`、`compact`、`contextual`、`micro`、`icon`，不改变 `sm`/`md`/`lg` 的高度含义。逐个审查 117 个 `<Button>` 调用点，为每个显式选择变体：普通操作和对话框底栏用 `standard`，工具栏和紧凑场景按规范选择。在 Comments 中记录调用点清单和选择理由。
- [x] Input、Select、Textarea（`agents/prompt-input.tsx` 除外，composer 是规范点名的几何）、Switch（包括 provider 的 32×18 变体）、Checkbox 和 Radio 按目标表实现。错误提示与对应字段保持关联。
- [x] 菜单：dropdown、context 和 Select 面板统一壳与行的 token。Session 菜单的入口改用紧凑变体。菜单出现和消失都是即时的，不带退出动画。
- [x] 覆盖层：Popover、Tooltip 和 MorphingModal 接入 ticket 02 的覆盖层阴影角色。MorphingModal 的标题和底栏固定可见，正文滚动，在视口内钳制为宽高各减 32px。
- [x] 删除页面对原语内部元素的覆盖，改用原语变体：
  - `.project-dialog > div` 的内边距、`.project-dialog button … > svg`。
  - `.app-titlebar-navigation button` 的尺寸和焦点样式。
  - 各页面对 MorphingModal 内容额外加的 `p-2`。
- [x] 交互状态：hover 只改变指向的目标，不改变几何；按下不加额外反馈；禁用为 50% 不透明度，并同时阻止指针和键盘；焦点为 2px，不被裁切，并且独立于 hover。光标按 Web PC interaction 表实现，嵌套的图标和标签继承光标。
- [x] 规范点名的功能尺寸保持不变：Project 对话框 480/416/520/448px，以及其中的 32px 字段和 36px 主操作；设置页字段；Goal 和 worktree 的局部对话框；模型选择器；搜索面板；composer。这些位置如果原来依赖共享默认值，要改为显式使用局部变体，确保它们的几何不变。
- [x] 测试：
  - 在 `compact-foundation`、`compact-overlays`、`compact-center-modal`、`f01-controls`、`select`、`input-focus`、`press-feedback`、`instant-interactions` 中，按上表更新断言并补齐新变体。
  - 功能套件中规范点名的尺寸断言保持不变。
  - 覆盖 14px 与 18px 界面字号、420px 宽度、计算光标，以及禁用目标拒绝指针和键盘。
  - 运行一次 `bun run test:desktop`。
- [x] 运行 `bun run check:dev`。用 agent-browser 验收：在 Light、Dark 和窄宽度下检查对话框、菜单、Select、设置表单和 Session 菜单，检查控制台与网络。

## Comments

### Pre-edit consumer authorization

All shared changes follow the authorized table above; named feature geometry remains scoped via primitive owner props. No generic Textarea exists; the sole prompt-input textarea remains excluded. No new unused Textarea is introduced. Existing installed beUI primitives cover every implemented role.

| Consumer                                                              | Planned Button role | Reason                                                     |
| --------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| `packages/ui/src/app/worktree-settings.tsx:141`                       | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/worktree-settings.tsx:165`                       | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/worktree-settings.tsx:206`                       | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/worktree-settings.tsx:209`                       | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/index.tsx:934`                                   | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/index.tsx:954`                                   | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/index.tsx:1019`                                  | icon                | Icon geometry                                              |
| `packages/ui/src/app/index.tsx:1030`                                  | icon                | Icon geometry                                              |
| `packages/ui/src/app/index.tsx:1042`                                  | icon                | Icon geometry                                              |
| `packages/ui/src/app/index.tsx:1080`                                  | icon                | Icon geometry                                              |
| `packages/ui/src/app/index.tsx:1147`                                  | icon                | Icon geometry                                              |
| `packages/ui/src/app/index.tsx:1167`                                  | icon                | Icon geometry                                              |
| `packages/ui/src/app/index.tsx:1178`                                  | icon                | Icon geometry                                              |
| `packages/ui/src/app/rename-session.tsx:99`                           | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/rename-session.tsx:102`                          | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/rename-session.tsx:106`                          | icon                | Icon geometry                                              |
| `packages/ui/src/app/model-services.tsx:574`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:600`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:627`                          | icon                | Icon geometry                                              |
| `packages/ui/src/app/model-services.tsx:635`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:657`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:671`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:690`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:730`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:744`                          | icon                | Icon geometry                                              |
| `packages/ui/src/app/model-services.tsx:755`                          | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:770`                          | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:812`                          | icon                | Icon geometry                                              |
| `packages/ui/src/app/model-services.tsx:923`                          | icon                | Icon geometry                                              |
| `packages/ui/src/app/model-services.tsx:956`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:997`                          | icon                | Icon geometry                                              |
| `packages/ui/src/app/model-services.tsx:1006`                         | icon                | Icon geometry                                              |
| `packages/ui/src/app/model-services.tsx:1014`                         | icon                | Icon geometry                                              |
| `packages/ui/src/app/model-services.tsx:1033`                         | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:1076`                         | icon                | Icon geometry                                              |
| `packages/ui/src/app/model-services.tsx:1231`                         | icon                | Icon geometry                                              |
| `packages/ui/src/app/model-services.tsx:1276`                         | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:1382`                         | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:1391`                         | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:1427`                         | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:1430`                         | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:1442`                         | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/model-services.tsx:1450`                         | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-directories.tsx:66`                      | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-directories.tsx:78`                      | icon                | Icon geometry                                              |
| `packages/ui/src/app/project-create.tsx:80`                           | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-create.tsx:91`                           | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-create.tsx:107`                          | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-create.tsx:110`                          | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-dialog.tsx:45`                           | icon                | Icon geometry                                              |
| `packages/ui/src/app/goal-confirmation.tsx:42`                        | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/goal-confirmation.tsx:45`                        | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-edit.tsx:163`                            | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-edit.tsx:186`                            | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-edit.tsx:199`                            | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-edit.tsx:202`                            | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-remove.tsx:68`                           | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-remove.tsx:71`                           | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/delete-session.tsx:89`                           | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/delete-session.tsx:92`                           | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/delete-session.tsx:102`                          | icon                | Icon geometry                                              |
| `packages/ui/src/app/project-trust.tsx:67`                            | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/app/project-trust.tsx:85`                            | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/model-picker.tsx:87`                      | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/model-picker.tsx:194`                     | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/transcript.tsx:501`                       | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/project-row.tsx:279`                      | icon                | Icon geometry                                              |
| `packages/ui/src/components/project-row.tsx:350`                      | icon                | Icon geometry                                              |
| `packages/ui/src/components/project-row.tsx:385`                      | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/goal-status.tsx:86`                       | icon                | Icon geometry                                              |
| `packages/ui/src/components/goal-status.tsx:103`                      | icon                | Icon geometry                                              |
| `packages/ui/src/components/conversation-dock.tsx:173`                | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/conversation-dock.tsx:181`                | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/conversation-dock.tsx:269`                | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/composer.tsx:127`                         | icon                | Icon geometry                                              |
| `packages/ui/src/components/composer.tsx:186`                         | icon                | Icon geometry                                              |
| `packages/ui/src/components/composer.tsx:265`                         | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/composer.tsx:316`                         | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/composer.tsx:336`                         | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/composer.tsx:357`                         | icon                | Icon geometry                                              |
| `packages/ui/src/components/composer.tsx:371`                         | icon                | Icon geometry                                              |
| `packages/ui/src/components/sidebar.tsx:121`                          | icon                | Icon geometry                                              |
| `packages/ui/src/components/sidebar.tsx:133`                          | icon                | Icon geometry                                              |
| `packages/ui/src/components/sidebar.tsx:187`                          | icon                | Icon geometry                                              |
| `packages/ui/src/components/sidebar.tsx:255`                          | icon                | Icon geometry                                              |
| `packages/ui/src/components/sidebar.tsx:327`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/sidebar.tsx:353`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/sidebar.tsx:364`                          | icon                | Icon geometry                                              |
| `packages/ui/src/components/sidebar.tsx:404`                          | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/plan-pane.tsx:48`                         | icon                | Icon geometry                                              |
| `packages/ui/src/components/plan-pane.tsx:59`                         | icon                | Icon geometry                                              |
| `packages/ui/src/components/plan-pane.tsx:87`                         | icon                | Icon geometry                                              |
| `packages/ui/src/components/plan-pane.tsx:90`                         | icon                | Icon geometry                                              |
| `packages/ui/src/components/tool-row.tsx:151`                         | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/tool-row.tsx:162`                         | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/plan-preview.tsx:27`                      | icon                | Icon geometry                                              |
| `packages/ui/src/components/plan-preview.tsx:30`                      | icon                | Icon geometry                                              |
| `packages/ui/src/components/plan-preview.tsx:40`                      | icon                | Icon geometry                                              |
| `packages/ui/src/components/agents/tool-approval.tsx:225`             | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/tool-approval.tsx:234`             | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/tool-approval.tsx:243`             | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/prompt-input.tsx:214`              | icon                | Icon geometry                                              |
| `packages/ui/src/components/agents/prompt-input.tsx:315`              | icon                | Icon geometry                                              |
| `packages/ui/src/components/motion/action-swap.tsx:91`                | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/approval-card/index.tsx:409`       | icon                | Icon geometry                                              |
| `packages/ui/src/components/agents/approval-card/index.tsx:421`       | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/approval-card/index.tsx:446`       | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/approval-card/index.tsx:457`       | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/approval-card/index.tsx:468`       | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/approval-card/interaction.tsx:187` | icon                | Icon geometry                                              |
| `packages/ui/src/components/agents/approval-card/interaction.tsx:239` | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/approval-card/interaction.tsx:309` | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/approval-card/interaction.tsx:324` | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/agents/approval-card/interaction.tsx:334` | contextual          | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/motion/button/metallic.tsx:11`            | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/motion/button/stateful.tsx:49`            | standard            | Explicit semantic owner; scoped feature geometry preserved |
| `packages/ui/src/components/motion/button/magnetic.tsx:16`            | standard            | Explicit semantic owner; scoped feature geometry preserved |

Scoped owners: Project Input/Select32 and modal20/24; Goal/worktree modal20/24 and footer; settings Input/Select32, Switch32x18, modal zero inset; composer and model controls retain28/24; titlebar icon24 uses inset focus. All other generic fields36/r12, modal24, menu shells12 and rows8. Worktree refresh32 is explicitly authorized.

Select standard linebox: base14/20 plus8px vertical inset and2px border computes38px (36px minimum), replacing32px. Scoped32 retains4px inset and20px linebox. Generic Input becomes12/16 andr12; old assertions20 lineheight/r8 now intentionally change. Protected Project Cancel/Remove/add-folder32 and primary36 retained.

Browser-discovered scoped modal clamp: settings retains its existing10px vertical offset through MorphingModal geometry="settings". At700px height, former668px panel +10px offset reachedy689,5px past16px bottomclearance. Owner nowincludesoffset inmaximum (viewport−42), giving658px andbottom684. Wide704px modeldialog/header82/footer60 remainunchanged; authorizedviewportclamprepair.

### Final Button role audit

Every product Button has an explicit semantic role or forwards its caller's explicit role. Protected Project auxiliary actions, settings and Interaction use compact; ordinary approval/footer actions use standard. Project primary selection and model reasoning chips use micro. Titlebar retains icon with inset focus; Goal actions use the named corner geometry. Legacy sm/md/lg height aliases remain available to installed consumers.

| Current consumer                                                      | Final owner size                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/ui/src/app/worktree-settings.tsx:141`                       | `"compact"`                                                    |
| `packages/ui/src/app/worktree-settings.tsx:170`                       | `"contextual"`                                                 |
| `packages/ui/src/app/worktree-settings.tsx:212`                       | `"compact"`                                                    |
| `packages/ui/src/app/worktree-settings.tsx:222`                       | `"standard"`                                                   |
| `packages/ui/src/app/index.tsx:934`                                   | `"contextual"`                                                 |
| `packages/ui/src/app/index.tsx:958`                                   | `"contextual"`                                                 |
| `packages/ui/src/app/index.tsx:1023`                                  | `"icon"`                                                       |
| `packages/ui/src/app/index.tsx:1035`                                  | `"icon"`                                                       |
| `packages/ui/src/app/index.tsx:1048`                                  | `"icon"`                                                       |
| `packages/ui/src/app/index.tsx:1087`                                  | `"icon"`                                                       |
| `packages/ui/src/app/index.tsx:1163`                                  | `"icon"`                                                       |
| `packages/ui/src/app/index.tsx:1184`                                  | `"icon"`                                                       |
| `packages/ui/src/app/index.tsx:1196`                                  | `"icon"`                                                       |
| `packages/ui/src/app/rename-session.tsx:105`                          | `"standard"`                                                   |
| `packages/ui/src/app/rename-session.tsx:108`                          | `"standard"`                                                   |
| `packages/ui/src/app/rename-session.tsx:112`                          | `"icon"`                                                       |
| `packages/ui/src/app/model-services.tsx:575`                          | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:601`                          | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:628`                          | `"icon"`                                                       |
| `packages/ui/src/app/model-services.tsx:636`                          | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:658`                          | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:672`                          | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:691`                          | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:731`                          | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:745`                          | `"icon"`                                                       |
| `packages/ui/src/app/model-services.tsx:756`                          | `"compact"`                                                    |
| `packages/ui/src/app/model-services.tsx:772`                          | `"compact"`                                                    |
| `packages/ui/src/app/model-services.tsx:816`                          | `"icon"`                                                       |
| `packages/ui/src/app/model-services.tsx:930`                          | `"icon"`                                                       |
| `packages/ui/src/app/model-services.tsx:963`                          | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:1005`                         | `"icon"`                                                       |
| `packages/ui/src/app/model-services.tsx:1014`                         | `"icon"`                                                       |
| `packages/ui/src/app/model-services.tsx:1022`                         | `"icon"`                                                       |
| `packages/ui/src/app/model-services.tsx:1041`                         | `"compact"`                                                    |
| `packages/ui/src/app/model-services.tsx:1086`                         | `"icon"`                                                       |
| `packages/ui/src/app/model-services.tsx:1244`                         | `"icon"`                                                       |
| `packages/ui/src/app/model-services.tsx:1289`                         | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:1401`                         | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:1410`                         | `"contextual"`                                                 |
| `packages/ui/src/app/model-services.tsx:1452`                         | `"compact"`                                                    |
| `packages/ui/src/app/model-services.tsx:1455`                         | `"compact"`                                                    |
| `packages/ui/src/app/model-services.tsx:1467`                         | `"compact"`                                                    |
| `packages/ui/src/app/model-services.tsx:1476`                         | `"compact"`                                                    |
| `packages/ui/src/app/project-directories.tsx:66`                      | `"micro"`                                                      |
| `packages/ui/src/app/project-directories.tsx:78`                      | `"icon"`                                                       |
| `packages/ui/src/app/project-create.tsx:81`                           | `"compact"`                                                    |
| `packages/ui/src/app/project-create.tsx:93`                           | `"standard"`                                                   |
| `packages/ui/src/app/project-create.tsx:110`                          | `"compact"`                                                    |
| `packages/ui/src/app/project-create.tsx:113`                          | `"standard"`                                                   |
| `packages/ui/src/app/project-dialog.tsx:46`                           | `"icon"`                                                       |
| `packages/ui/src/app/goal-confirmation.tsx:43`                        | `"standard"`                                                   |
| `packages/ui/src/app/goal-confirmation.tsx:46`                        | `"standard"`                                                   |
| `packages/ui/src/app/project-edit.tsx:164`                            | `"compact"`                                                    |
| `packages/ui/src/app/project-edit.tsx:188`                            | `"compact"`                                                    |
| `packages/ui/src/app/project-edit.tsx:202`                            | `"compact"`                                                    |
| `packages/ui/src/app/project-edit.tsx:205`                            | `"standard"`                                                   |
| `packages/ui/src/app/project-remove.tsx:68`                           | `"standard"`                                                   |
| `packages/ui/src/app/project-remove.tsx:78`                           | `"standard"`                                                   |
| `packages/ui/src/app/delete-session.tsx:89`                           | `"standard"`                                                   |
| `packages/ui/src/app/delete-session.tsx:99`                           | `"standard"`                                                   |
| `packages/ui/src/app/delete-session.tsx:110`                          | `"icon"`                                                       |
| `packages/ui/src/app/project-trust.tsx:67`                            | `"standard"`                                                   |
| `packages/ui/src/app/project-trust.tsx:86`                            | `"compact"`                                                    |
| `packages/ui/src/components/model-picker.tsx:87`                      | `"contextual"`                                                 |
| `packages/ui/src/components/model-picker.tsx:194`                     | `"micro"`                                                      |
| `packages/ui/src/components/transcript.tsx:501`                       | `"contextual"`                                                 |
| `packages/ui/src/components/project-row.tsx:279`                      | `"icon"`                                                       |
| `packages/ui/src/components/project-row.tsx:350`                      | `"icon"`                                                       |
| `packages/ui/src/components/project-row.tsx:385`                      | `"compact"`                                                    |
| `packages/ui/src/components/agents/tool-approval.tsx:225`             | `"standard"`                                                   |
| `packages/ui/src/components/agents/tool-approval.tsx:235`             | `"standard"`                                                   |
| `packages/ui/src/components/agents/tool-approval.tsx:245`             | `"standard"`                                                   |
| `packages/ui/src/components/agents/prompt-input.tsx:214`              | `"icon"`                                                       |
| `packages/ui/src/components/agents/prompt-input.tsx:318`              | `"icon"`                                                       |
| `packages/ui/src/components/agents/approval-card/index.tsx:409`       | `"icon"`                                                       |
| `packages/ui/src/components/agents/approval-card/index.tsx:421`       | `{currentStep === questions.length - 1 ? "standard" : "icon"}` |
| `packages/ui/src/components/agents/approval-card/index.tsx:446`       | `"standard"`                                                   |
| `packages/ui/src/components/agents/approval-card/index.tsx:457`       | `"standard"`                                                   |
| `packages/ui/src/components/agents/approval-card/index.tsx:468`       | `"standard"`                                                   |
| `packages/ui/src/components/agents/approval-card/interaction.tsx:187` | `"icon"`                                                       |
| `packages/ui/src/components/agents/approval-card/interaction.tsx:239` | `"compact"`                                                    |
| `packages/ui/src/components/agents/approval-card/interaction.tsx:311` | `"compact"`                                                    |
| `packages/ui/src/components/agents/approval-card/interaction.tsx:327` | `"contextual"`                                                 |
| `packages/ui/src/components/agents/approval-card/interaction.tsx:337` | `"contextual"`                                                 |
| `packages/ui/src/components/goal-status.tsx:86`                       | `"icon"`                                                       |
| `packages/ui/src/components/goal-status.tsx:103`                      | `"icon"`                                                       |
| `packages/ui/src/components/motion/action-swap.tsx:91`                | `{size}`                                                       |
| `packages/ui/src/components/motion/button/metallic.tsx:11`            | `"standard"`                                                   |
| `packages/ui/src/components/motion/button/stateful.tsx:49`            | `"standard"`                                                   |
| `packages/ui/src/components/motion/button/magnetic.tsx:16`            | `"standard"`                                                   |
| `packages/ui/src/components/conversation-dock.tsx:173`                | `"contextual"`                                                 |
| `packages/ui/src/components/conversation-dock.tsx:181`                | `"contextual"`                                                 |
| `packages/ui/src/components/conversation-dock.tsx:269`                | `"compact"`                                                    |
| `packages/ui/src/components/composer.tsx:127`                         | `"icon"`                                                       |
| `packages/ui/src/components/composer.tsx:186`                         | `"icon"`                                                       |
| `packages/ui/src/components/composer.tsx:265`                         | `"contextual"`                                                 |
| `packages/ui/src/components/composer.tsx:316`                         | `"contextual"`                                                 |
| `packages/ui/src/components/composer.tsx:336`                         | `"contextual"`                                                 |
| `packages/ui/src/components/composer.tsx:357`                         | `"icon"`                                                       |
| `packages/ui/src/components/composer.tsx:371`                         | `"icon"`                                                       |
| `packages/ui/src/components/sidebar.tsx:121`                          | `"icon"`                                                       |
| `packages/ui/src/components/sidebar.tsx:133`                          | `"icon"`                                                       |
| `packages/ui/src/components/sidebar.tsx:187`                          | `"icon"`                                                       |
| `packages/ui/src/components/sidebar.tsx:255`                          | `"icon"`                                                       |
| `packages/ui/src/components/sidebar.tsx:327`                          | `"contextual"`                                                 |
| `packages/ui/src/components/sidebar.tsx:353`                          | `"contextual"`                                                 |
| `packages/ui/src/components/sidebar.tsx:364`                          | `"icon"`                                                       |
| `packages/ui/src/components/sidebar.tsx:404`                          | `"contextual"`                                                 |
| `packages/ui/src/components/plan-pane.tsx:48`                         | `"icon"`                                                       |
| `packages/ui/src/components/plan-pane.tsx:59`                         | `"icon"`                                                       |
| `packages/ui/src/components/plan-pane.tsx:87`                         | `"icon"`                                                       |
| `packages/ui/src/components/plan-pane.tsx:90`                         | `"icon"`                                                       |
| `packages/ui/src/components/tool-row.tsx:151`                         | `"contextual"`                                                 |
| `packages/ui/src/components/tool-row.tsx:162`                         | `"contextual"`                                                 |
| `packages/ui/src/components/plan-preview.tsx:27`                      | `"icon"`                                                       |
| `packages/ui/src/components/plan-preview.tsx:30`                      | `"icon"`                                                       |
| `packages/ui/src/components/plan-preview.tsx:40`                      | `"icon"`                                                       |

### Delivery evidence

Implemented with installed beUI owners and existing Radix dropdown; no custom or unused primitive introduced. Tooltip and Popover already consume the shared overlay token with target geometry and needed no duplicate edit. Generic Textarea is absent; composer textarea is the explicit exclusion. All 117 Button call sites are enumerated above and audited through the TypeScript JSX tree: 22 standard, 19 compact, 28 contextual, 2 micro, 44 icon, one conditional standard/icon and one forwarding adapter.

Applicable verification completed locally on integrated ticket03 tip `1bb8bffe` plus this diff. `bun run test:desktop` initially failed 4/363 cases across 3/64 files (22.80s); 359 cases passed. Incremental checks repaired the authorized stale generic geometry/settings palette assertions and covered all remaining cases. The package result remains recorded as failed, with passing incremental evidence; it is not described as a fresh full green run. All protected geometry assertions remain unchanged. Public Session menu geometry tests found and fixed titlebar Copy/Open entries; low-height model dialog test reproduced and repaired the 5px viewport clearance defect while keeping wide settings geometry.

`bun run check:dev` first stopped on one formatting issue. After formatting, lint, types, Knip, tracker, docs, boundaries, policy and typography passed. The later scoped modal change passed changed-file formatting/lint and `tsc -b`; final documentation/policy/typography checks cover the added test and tracker narrative. Exact commands, failures, counts, timings and logs live in the external verification record `verification-04.md` supplied to the integration owner.

Isolated Chromium acceptance checked Light, Dark, 420px width and 18px text: Project dialogs, Select/settings fields, model dialog body scrolling and pinned header/footer, disabled state, Session menus, nested cursors, keyboard focus and Escape restoration. Screenshots and console/network evidence are supplied with the verification record; errors were empty and resources returned 200. Browser and owned launcher/sidecar/Vite processes exited, ports and temporary data were removed, and the unrelated IPv6 Vite was preserved. No Electron or keychain access occurred.

ADR coverage: this ticket only changes primitive presentation geometry and local owner variants; it preserves package ownership, dependency direction, protocols, persistence and trust, so it introduces no durable architecture decision. The spec's ADR coverage remains applicable. Root owns fresh final review, push and dependency-stacked PR delivery; CI is not claimed here.
