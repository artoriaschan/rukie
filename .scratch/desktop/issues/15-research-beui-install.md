# 15: beUI 在 Vite 8 与 Tailwind 4 下的安装与改写面

Type: research

Blocked by: None

Status: resolved

## Question

按 beUI 优先、shadcn 补位的新规则（[07](07-research-beui.md#comments)），实测在一个临时 Vite 8.3.1 + React 19.3.0 + Tailwind 4.3.3 项目中经 shadcn CLI 安装 09 需要的 beUI 组件（按钮、菜单、popover、命令面板、tooltip、dialog、流式/思考/工具活动反馈）与必要的 shadcn 补位组件：能否构建、引入哪些依赖（精确版本）、主题 token 与 `--glass-*`/`--neon` 如何接 DESIGN.md、`text-ui-*` 在 Tailwind 4 中的定义方式、拷入后需改写的字号与硬编码文案规模、Markdown 渲染接入点，以及能否用 lint 禁止非 `text-ui-*` 字号类。

## Answer

- 完整调研：[research/beui-install.md](../research/beui-install.md)（2026-10-10 临时项目实测，shadcn CLI 4.21.4）。构建：`shadcn init -t vite -b radix -p nova` 后安装 23 个 beUI 组件和 shadcn `dropdown-menu`，`tsc -b && vite build` 通过。要先改一处 CLI 错误：`@/lib/text-shimmer` 被改写成自引用，涉及 2 个文件。另外 TS 6 下 tsconfig 不能写 `baseUrl`。
- 组件分工：按钮、tooltip、popover、命令面板、模态框、抽屉、select 和全部 Agent 反馈都用 beUI。beUI 没有点击触发、带子菜单的下拉菜单（`context-menu` 只响应右键，`bloom-menu` 没有菜单语义），会话、项目、账户、权限模式和模型菜单用 shadcn `dropdown-menu` 补位。
- 依赖：motion 14.1.0、clsx 2.1.1、tailwind-merge 3.7.0、@floating-ui/dom 1.8.0、shiki 4.5.0、lucide-react 1.55.0、radix-ui 1.7.0、class-variance-authority 0.7.1、tw-animate-css 1.4.0。CLI 写入的是 `^` 范围，需要改成精确版本。`cn` 0.4.0 和 Geist 字体删除；`shadcn` 4.21.4 运行时依赖只为提供 `data-open/closed` 变体，可以抄进 CSS 后去掉。shiki 改用 `shiki/core` 细粒度导入后，dist 从 11 MB 降到 1.3 MB。
- 主题：registry 项不带 `cssVars`。以 beUI `theme.css` 为模板，换上 DESIGN.md 的 GitHub 值即可，`--glass-*`/`--neon` 只改值。实际安装的组件没有用到 `glass` 工具类；有 68 处硬编码 `emerald/rose/blue/amber`，需要改为语义 token 或 `diff-*`。
- `text-ui-*`：在 `@theme inline` 中定义 `--text-ui-*` 与 `--line-height` 子变量即可生成工具类。阻断项：默认的 tailwind-merge 和 shadcn 的 `cn` 包都会把 `text-ui-sm` 当颜色类，与 `text-muted-foreground` 合并时将其删除。必须用 `extendTailwindMerge`，shadcn 组件也要改为引用 `@/lib/utils`。
- 改写规模：68 个文件中，字号类共 100 处，89 处可机械替换，11 处需判断，另有内联 `fontSize` 3 处。硬编码英文文案约 90 条，分布在 24 个文件中，集中在审批、todo、活动流和命令面板。
- Markdown：渲染器输出作为 `StreamingResponse`/`MessageBubble` 的 `children` 传入，标题和行内代码由渲染器直接输出 `text-ui-*` 类，围栏代码交给 `CodeBlock`。
- lint：oxlint 1.86 `jsPlugins` 本地规则约 25 行，实测命中全部 100 处和内联 `fontSize`，无误报。`jsPlugins` 是 alpha；要求稳定的话，可以用同一个正则写成 `scripts/check-*.ts` 接入 `check:dev`。
