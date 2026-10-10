# 27: ui 主题、组件安装与 DESIGN.md 修订

**What to build:** 安装主窗口需要的 beUI 组件与 shadcn `dropdown-menu`，按 DESIGN.md 改写主题、字号、颜色与文案，并同步 DESIGN.md 与 tech-stack。见 [spec](../spec.md) 的「界面组件与外观」与 [15](15-research-beui-install.md#answer)。

Blocked by: 23

Status: ready-for-agent

- [ ] shadcn CLI 4.21.4 安装所需 beUI 组件与 `dropdown-menu`，修正 `@/lib/text-shimmer` 自引用，删除 `cn` 包与 Geist 字体，全部依赖精确锁定
- [ ] 主题 CSS 以 beUI `theme.css` 为模板换 GitHub Light/Dark 值，`text-ui-*` 定义在 `@theme inline`，`cn()` 用 `extendTailwindMerge` 且 shadcn 组件引用它；`text-ui-sm` 与颜色类合并不丢失有测试
- [ ] 字号类、硬编码颜色（状态 token 或 `diff-*`）与英文文案（zh/en 字典）全部改写，字号 lint 通过
- [ ] `dropdown-menu` 浮层表面与 beUI 一致；所有动画遵循 `prefers-reduced-motion`
- [ ] DESIGN.md：记录 `dropdown-menu` 补位、重写 glass 一句、允许交互底色的 `foreground` alpha、补 `ansi-*` token 与 `text-[11px]`/`text-[13px]` 字号行高；tech-stack 更新 lucide-react 1.55.0 等版本
- [ ] GUI 浏览器验证：Light/Dark、窄窗口与 popover 滤镜性能
