# 01: `@neant/i18n` 与 TUI locale 解析（tracer bullet）

Status: ready-for-agent

**What to build:** 英文环境（`LANG=en_US.UTF-8`）启动 TUI，状态栏的 Permission Mode 名称/说明与审批对话框三个选项显示英文；中文环境保持中文；用户级 settings `"locale"` 覆盖环境变量。打通 `@neant/i18n` → settings → TUI 启动 → 渲染整条路径。见 spec Implementation Decisions 的 `@neant/i18n`、`@neant/shared`（settings 部分）、Agent Core（配置合并）、TUI 节。

**Blocked by:** None (can start immediately)

- [ ] 新包 `@neant/i18n`：运行时无关（无 `Bun.*`、`node:*`、DOM），提供 `Locale`、`resolveLocale`、`createI18n`（通用 + app 字典组合、`{{name}}` 插值、app 覆盖通用 key 时类型报错、缺 key 返回 key）、`fmtDuration(ms, locale)`
- [ ] 通用文案：三种 Permission Mode 名称与说明（含紧凑版）、三个审批选项；zh 基准，en 用 `satisfies` 约束 key 一致
- [ ] `resolveLocale`：按序取首个可识别候选；空、`C`、`POSIX`（含 `C.UTF-8`）跳过；`zh*` → zh，`en*` → en；否则回退 `en`
- [ ] `SettingsSchema` 新增可选 `locale: string`；项目级 `locale` 被忽略并产生 warning
- [ ] TUI `main` io 新增 `env` 注入（缺省 `process.env`）；settings 加载后、渲染前按 settings `locale` → `LC_ALL` → `LC_MESSAGES` → `LANG` 解析一次
- [ ] 状态栏模式文案与审批对话框选项改用通用文案
- [ ] 测试 `start()` 默认注入 zh 环境，现有 e2e 不改断言仍通过
- [ ] 测试：`@neant/i18n` 单元测试（解析优先级/跳过/回退、插值、缺 key、`fmtDuration`、通用文案 zh/en 占位符一致）；TUI e2e 覆盖 en / zh / settings 覆盖 / `LANG=C` 回退；agent config 测试覆盖项目级 `locale` warning
- [ ] 更新 `CLAUDE.md` Repo layout 与 `docs/tech-stack.md`
- [ ] `tsc -b` 与全部测试通过
