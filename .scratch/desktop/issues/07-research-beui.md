# 07: shadcn/beui 组件库

Type: research

Blocked by: None

Status: resolved

## Question

beui 即 [starc007/ui-components](https://github.com/starc007/ui-components)（用户确认），可经 beui skill 或 beui MCP 查询用法。它的 registry、许可证与维护状态如何？它与 shadcn CLI、tech-stack 中已列的 ai-elements 是什么关系，是替代还是并用？是否兼容 React 19.3、Tailwind CSS 4.3、Vite 8？聊天、代码块、工具调用、权限确认等 MVP 所需组件覆盖到什么程度？

## Answer

完整调研：[research/beui.md](../research/beui.md)。

- 身份：beUI（https://beui.dev），shadcn 官方 registry 目录收录的第三方 registry `@beui`，仓库 `starc007/ui-components`，MIT，个人维护但活跃（2026-10-06 仍有推送），138 项，其中 Agents 类 18 项。
- 与 shadcn：并用。经 `shadcn add @beui/<name>` 安装，沿用 shadcn 语义 token；基础原语（Button、Select、Popover 等）是 beUI 自带的 Motion 实现，不引用 shadcn 官方组件。
- 与 ai-elements：Agent 界面层几乎完全重叠，二选一。采用 beUI 默认风格即以 beUI 替代 ai-elements；tech-stack「组件原语」行需随 spec 改为“shadcn（token/CLI）+ beUI”。
- 兼容性：声明 React ^19 与 Tailwind v4；MVP 相关组件无 `next/*` import，可在 Vite 下使用（需 `@/` 别名），上游只在 Next 16 验证；未实际在 Vite 8 + React 19.3 下构建。
- MVP 覆盖：消息、流式跟随滚动、输入框、代码块、工具结果与活动流、diff、todo、权限确认（`tool-approval`：approve / always allow / deny）、侧边栏、对话框、`chat-app` 骨架。
- 缺口：无 Markdown 渲染，接 tech-stack 规划的 micromark + 自研 mdast→React；组件英文文案硬编码，拷入后需改为 `@rukie/i18n`；shiki 运行时只加载 5 种语言，需改源码扩展。

## Comments

- 2026-10-09：分工调整为 shadcn 负责标准组件与默认风格、beUI 只负责动效；beUI 组件的 glass/neon 表面改用 shadcn 表面。ai-elements 不再使用。
- 2026-10-10：分工再次调整为 beUI 优先：beUI 自带原语即项目的 Button/Select/Popover/Dialog 实现，保留 glass 表面与 neon，颜色取 GitHub token；beUI 未覆盖的角色（表单、表格、导航模式等）用 shadcn/ui，且不为 beUI 已有的角色再装 shadcn 原语。取代 2026-10-09 的分工。
