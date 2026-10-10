# 03: MVP 范围与产品约束

Type: grilling

Blocked by: None

Status: resolved

## Question

这次 effort 交付什么，Web 端定位如何，桌面 MVP 覆盖哪些能力，沿用哪些既定选型，UI 风格、设置与 i18n 如何处理？

## Answer

- 目的地：桌面端 MVP spec 与实现工单，不在地图内实现。
- 浏览器只作开发模式（renderer 在普通浏览器连本机 server）；架构上 renderer 不直接调用 Electron API，原生能力经注入的 host 接口，为将来 Web 产品留口子。
- MVP 最小闭环：选项目、新建或恢复 Session、流式对话、工具调用展示、权限 Interaction。
- 沿用 ADR-0001 sidecar、ADR-0004 Vitest 与 tech-stack 的 Electron/Vite/electron-builder 选型；后端加入 Effect（见 [01](01-packages-and-effect-boundary.md)）。
- 凭据与 provider 设置沿用现有用户设置，MVP 无设置界面。
- UI 组件采用 shadcn/beui 的默认风格（调研见 [07](07-research-beui.md)），界面布局参考 Pencil 视觉稿（见 [08](08-task-pencil-design-source.md)）。
- `packages/ui` 从一开始接入 `@rukie/i18n`，同步维护 zh/en。

## Comments

- 2026-10-09：用户调整 UI 风格：全部组件采用 shadcn 默认风格，beUI 只提供动效与 Agent 执行反馈；tech-stack「组件原语」改为 shadcn + beUI。上文“shadcn/beui 的默认风格”以此为准。
- 2026-10-10：用户再次调整：组件与原语优先使用 beUI，视觉基线为 beUI 默认风格（保留 glass 表面，颜色取 DESIGN.md 的 GitHub token），beUI 未覆盖的角色用 shadcn/ui。DESIGN.md、AGENTS.md 与 tech-stack 已同步；以此为准，取代 2026-10-09 的分工。
- 2026-10-10：用户收窄平台与交付方式：MVP 只支持 macOS arm64；只在本地编译出 ad-hoc 签名的 `.app`（可附 `.dmg`），不做 Developer ID 签名与公证；桌面端的构建、测试与打包不接入 GitHub Actions。Windows、Linux、x64 与 universal 构建移出本 effort。
