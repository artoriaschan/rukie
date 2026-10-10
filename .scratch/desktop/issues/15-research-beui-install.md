# 15: beUI 在 Vite 8 与 Tailwind 4 下的安装与改写面

Type: research

Blocked by: None

Status: needs-triage

## Question

按 beUI 优先、shadcn 补位的新规则（[07](07-research-beui.md#comments)），实测在一个临时 Vite 8.3.1 + React 19.3.0 + Tailwind 4.3.3 项目中经 shadcn CLI 安装 09 需要的 beUI 组件（按钮、菜单、popover、命令面板、tooltip、dialog、流式/思考/工具活动反馈）与必要的 shadcn 补位组件：能否构建、引入哪些依赖（精确版本）、主题 token 与 `--glass-*`/`--neon` 如何接 DESIGN.md、`text-ui-*` 在 Tailwind 4 中的定义方式、拷入后需改写的字号与硬编码文案规模、Markdown 渲染接入点，以及能否用 lint 禁止非 `text-ui-*` 字号类。
