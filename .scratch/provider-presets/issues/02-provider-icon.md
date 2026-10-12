# 02：`@lobehub/icons` 与 ProviderIcon

Status: claimed

Blocked by: 01

**What to build:** 按 [spec 图标依赖](../spec.md#图标依赖)引入 `@lobehub/icons`，由 `ProviderIcon` 统一渲染服务图标，替换手写 SVG 和别名推断。

- [x] 安装 `@lobehub/icons@5.23.0`（精确锁定），不安装 `antd` 与 `@lobehub/ui`；检查 bun 关于缺失 peer 的提示不影响安装与构建，必要时在配置中做窄范围说明
- [x] `provider-icon.tsx` 改为入参 `icon?: ProviderIconKey`，通过 `Record<ProviderIconKey, { mono, color }>` 穷尽映射，深导入 `es/DeepSeek/components/Mono` 与 `Color`；缺省使用 lucide `Box`；需要模块声明时补齐并注明原因
- [x] 删除手写的 deepseek/openai/zhipu SVG 与别名表
- [x] 模型选择器（`model-picker.tsx`）使用 `entry.providerIcon`；设置页供应商列表与详情头部使用服务的 `icon`
- [ ] 确认深导入只经由 `provider-icon.tsx`，knip 与 lint 通过
- [x] 更新 `docs/tech-stack.md`（界面一节）和 lockfile；DESIGN.md "Conversation model controls"中 Brand paths 相关的描述改为 `ProviderIcon` 和 `icon` 键
- [x] 测试：Chromium 断言 DeepSeek 服务在三处渲染品牌图标，没有 `icon` 的服务显示 Box；图标有可访问名称或标记为装饰性，与周围文本一致

## Comments

### Implementation evidence (2026-10-13)

- Fresh implementer, branch `feat/provider-presets-02`, worktree `/tmp/rukie-provider-presets-02`. ProviderIcon reuses the existing presentation boundary; the spec mandates Lobe SVG assets because beUI/shadcn do not supply these provider brand assets. No new UI primitive.
- DeepSeek Mono/Color imports only in provider-icon.tsx; exhaustive ProviderIconKey record, decorative aria-hidden, Box fallback independent of names/ids. List/header use Color; picker uses Mono. Draft selection/save retains icon and enabled. Existing composer assertion now expects Box for unmarked OpenAI.
- TDD: settings list/header test first failed on missing brand, then passed; picker test first failed on missing explicit catalog brand, then passed. `rtk proxy bunx --no vitest run tests/app/provider-icons.browser.test.tsx tests/components/composer.browser.test.tsx -t 'service list and detail|model picker uses|Pencil model panels preserve'` from packages/ui: 3 passed / 5 filtered, 1.21s; individual icon tests below 1s.
- A fresh `rtk proxy bun install --frozen-lockfile` after removing only this worktree’s generated node_modules installed 887 packages in 1.03s. A filesystem package-manifest audit found neither antd nor @lobehub/ui; UI React and ReactDOM resolve. Bun’s lockfile includes unused peer resolution metadata; it is not installed. Repository-wide peer=false policy and explicit UI React devDependencies were approved by coordinator and documented in tech-stack/ADR-0038.
- `rtk proxy node node_modules/vite/bin/vite.js build packages/ui --config packages/ui/vite.config.ts --outDir /tmp/rukie-provider-presets-evidence/icon-vite-build`: passed, 3355 modules, 402ms. Existing chunk-size warning (>500kB) and external output path notice; no Electron launch. Library declarations resolve without ambient additions.
- Vitest prebundles the two SVG paths to avoid the initial optimizer-triggered test reload. Owner runs aggregate static/docs and one full check due global dependency-install policy; ticket06 owns desktop/manual GUI evidence. Status stays claimed until final review and acceptance.
- ADR coverage: ADR-0038 impact now records global peer installation policy; no new durable architecture decision outside existing provider-icon ownership.
