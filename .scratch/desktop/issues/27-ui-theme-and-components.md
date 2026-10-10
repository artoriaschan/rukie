# 27: ui 主题、组件安装与 DESIGN.md 修订

**What to build:** 安装主窗口需要的 beUI 组件与 shadcn `dropdown-menu`，按 DESIGN.md 改写主题、字号、颜色与文案，并同步 DESIGN.md 与 tech-stack。见 [spec](../spec.md) 的「界面组件与外观」与 [15](15-research-beui-install.md#answer)。

Blocked by: 23

Status: claimed

- [x] shadcn CLI 4.21.4 安装所需 beUI 组件与 `dropdown-menu`，修正 `@/lib/text-shimmer` 自引用，删除 `cn` 包与 Geist 字体，全部依赖精确锁定
- [x] 主题 CSS 以 beUI `theme.css` 为模板换 GitHub Light/Dark 值，`text-ui-*` 定义在 `@theme inline`，`cn()` 用 `extendTailwindMerge` 且 shadcn 组件引用它；`text-ui-sm` 与颜色类合并不丢失有测试
- [x] 字号类、硬编码颜色（状态 token 或 `diff-*`）与英文文案（zh/en 字典）全部改写，字号 lint 通过
- [x] `dropdown-menu` 浮层表面与 beUI 一致；所有动画遵循 `prefers-reduced-motion`
- [x] DESIGN.md：记录 `dropdown-menu` 补位、重写 glass 一句、允许交互底色的 `foreground` alpha、补 `ansi-*` token 与 `text-[11px]`/`text-[13px]` 字号行高；tech-stack 更新 lucide-react 1.55.0 等版本
- [x] GUI 浏览器验证：Light/Dark、窄窗口与 popover 滤镜性能

## Implementation evidence

- Installed the 23 beUI roles from the live registry with `shadcn@4.21.4 add`, plus shadcn `dropdown-menu`. beUI has no dropdown-menu role; this fallback composes the installed beUI Button and shares the surface/font helpers. Registry source was inspected before adaptation; no custom primitive replaces a registry role.
- Copied components now use GitHub theme/status/diff/ANSI tokens, the `text-ui-*` scale and explicit zh/en component copy. `UiLocaleProvider` receives the app-owned locale; components have no implicit document-language dependency. The component barrel exposes the installed role namespaces; gallery is a temporary browser entry for issue 28 to replace.
- `extendTailwindMerge` red/green regression covers keeping typography and text colors independent. Browser regressions cover Chinese permission callbacks, menu focus return and typography, and popover viewport-edge geometry. Browser acceptance exposed an offscreen narrow popover; the owning positioning code now clamps/flips against the viewport and limits panel height. The corrected narrow panel occupies x=8..264 in a 390px viewport.
- `bun run test:desktop`: 5 files / 8 tests passed, 1.23s. The duration includes Chromium startup and real DOM/focus/geometry measurement; no fixed waits or motion deadlines were added. `bun run check:dev` passed (including Knip, docs, typography and test policy). Production `vite build` passed; the temporary all-components gallery emits a 1.14MB JS chunk and Vite's >500KB advisory. Issue 28 owns the actual app entry and any resulting code splitting.
- Real-browser named gallery session verified Light/Dark, Chinese copy, keyboard menu selection/focus, 390px width with no document overflow, reduced motion, and popover. No app exceptions; app assets return 200, the optional favicon request returns 404. Sessions and Vite/static servers were closed. Screenshots are retained outside the worktree: `/tmp/rukie-desktop-evidence/issue27/light.png`, `dark.png`, `narrow-zh.png`, `popover-dark-narrow.png`, `reduced-motion.png` in the same directory.
- Popover trace `/tmp/rukie-desktop-evidence/issue27/popover-profile.json`: 40,745 RunTask events, max 24.751ms, none >50ms; 69 Paint events max 0.099ms, 24 UpdateLayoutTree events max 0.134ms, 30 RasterTask events max 0.046ms. This measures the narrow Dark popover, rather than initial application loading.
- Production built gallery was served with actual CSP headers. `style-src 'self'` permits React/Motion CSSOM property styling but opening Radix dropdown emits a `style-src-elem` violation for react-remove-scroll's injected scroll-lock CSS. With `style-src 'self'; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'none'`, dropdown open/Escape and popover open succeed with zero recorded securitypolicyviolation events and no console/app errors. Evidence `/tmp/rukie-desktop-evidence/issue27/production-csp.png`; issue 26/30 owners were notified to apply this scoped style policy. This is browser production-asset evidence, not packaged Electron evidence.
- ADR coverage: follows existing frontend ownership, locale and registry-source decisions; no new durable architectural trade-off introduced.

- After merging issue 26, its protocol now permits inline styles while keeping scripts self-only. The production browser measured the narrower element-only exception, but not every installed motion role was exercised under attribute blocking, so the app handler uses the normal style-only inline allowance without claiming universal attribute-blocking compatibility. Protocol regression failed on the prior CSP and passes on the revised policy; packaged app verification remains issue 30.

- Integration baseline `8493da9a` merged into this issue branch; lockfile and tech-stack resolution preserves server/Electron dependencies alongside UI dependencies. Merged-tree `bun run test:desktop`: 9 files / 17 tests passed, 1.31s; merged-tree `bun run check:dev` passed. Hooks remain enabled.
