# 01: `@neant/i18n` 与 TUI locale 解析（tracer bullet）

Status: done

**What to build:** 英文环境（`LANG=en_US.UTF-8`）启动 TUI，状态栏的 Permission Mode 名称/说明与审批对话框三个选项显示英文；中文环境保持中文；用户级 settings `"locale"` 覆盖环境变量。打通 `@neant/i18n` → settings → TUI 启动 → 渲染整条路径。见 spec Implementation Decisions 的 `@neant/i18n`、`@neant/shared`（settings 部分）、Agent Core（配置合并）、TUI 节。

**Blocked by:** None (can start immediately)

- [x] 新包 `@neant/i18n`：运行时无关（无 `Bun.*`、`node:*`、DOM），提供 `Locale`、`resolveLocale`、`createI18n`（通用 + app 字典组合、`{{name}}` 插值、app 覆盖通用 key 时类型报错、缺 key 返回 key）、`fmtDuration(ms, locale)`
- [x] 通用文案：三种 Permission Mode 名称与说明（含紧凑版）、三个审批选项；zh 基准，en 用 `satisfies` 约束 key 一致
- [x] `resolveLocale`：按序取首个可识别候选；空、`C`、`POSIX`（含 `C.UTF-8`）跳过；`zh*` → zh，`en*` → en；否则回退 `en`
- [x] `SettingsSchema` 新增可选 `locale: string`；项目级 `locale` 被忽略并产生 warning
- [x] TUI `main` io 新增 `env` 注入（缺省 `process.env`）；settings 加载后、渲染前按 settings `locale` → `LC_ALL` → `LC_MESSAGES` → `LANG` 解析一次
- [x] 状态栏模式文案与审批对话框选项改用通用文案
- [x] 测试 `start()` 默认注入 zh 环境，现有 e2e 不改断言仍通过
- [x] 测试：`@neant/i18n` 单元测试（解析优先级/跳过/回退、插值、缺 key、`fmtDuration`、通用文案 zh/en 占位符一致）；TUI e2e 覆盖 en / zh / settings 覆盖 / `LANG=C` 回退；agent config 测试覆盖项目级 `locale` warning
- [x] 更新 `CLAUDE.md` Repo layout 与 `docs/tech-stack.md`
- [x] `tsc -b` 与全部测试通过

## Comments

2026-10-03: 已完成。新增运行时无关的 `@neant/i18n`，从用户配置与注入环境解析启动 locale，并以 props 接入状态栏 Permission Mode 与审批选项。项目级 locale 在校验前丢弃并产生 warning；Agent Core 未引入 i18n 依赖。

验证：`rtk proxy env -u NO_COLOR bun run check` 通过（格式、lint、`tsc -b`、Knip、528 tests / 2929 assertions）。新增公开 API、配置与虚拟终端测试覆盖优先级、回退、配置覆盖、启动 locale 固定、插值、时长及类型约束；既有中文断言保持通过。

双轴 code-review：Standards 无发现；Spec 的英文 app key 覆盖与缺失 key 被插值两项已修复，并经复核确认。其余界面文案由票 02、activity/narration 及旧时长调用迁移由票 03、Agent Core 错误码由票 04 负责。
