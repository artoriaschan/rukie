Status: done

# Spec: 国际化（Locale：zh / en）

## Problem Statement

Neant 的 TUI 文案全部硬编码：界面、审批对话框、状态栏、activity 句池是中文，部分通知、启动报错、状态栏分段名又是英文，两种语言混杂。非中文用户看不懂界面；中文用户也会看到零散英文。Agent Core 还把中文直接写进抛给用户的错误（ripgrep 不可用）和返回给模型的 tool result（拒绝消息），使 transcript 带上界面语言。以后桌面端上线时，权限模式、审批选项等同一概念还要再写一遍文案，两端叫法会漂移。

## Solution

引入 **Locale**（见 `CONTEXT.md`）：frontend 呈现文案所用的语言，支持 `zh` 与 `en`，回退 `en`。

- 新增运行时无关的 `@neant/i18n` 包：locale 解析、字典组合与插值、时长格式化，以及跨端通用文案。
- TUI 启动时按 settings `locale` → `LC_ALL` → `LC_MESSAGES` → `LANG` → `en` 定下 locale，运行期间不变。
- TUI 所有用户可见文案（含现有中英文硬编码）改为查字典；activity 句池按 dsh-working-activity 0.5.1 的中英双池布局补齐英文；narration 状态行指令按 locale 注入。
- Agent Core 不感知 locale（ADR-0008）：面向用户的错误带错误码，由 frontend 查通用文案翻译；发给模型的文本固定英文。

## User Stories

1. 作为英文用户，我希望系统 `LANG=en_US.UTF-8` 时 TUI 全英文，以便不用学中文就能用 Neant。
2. 作为中文用户，我希望 `LANG=zh_CN.UTF-8` 时 TUI 全中文，以便维持现有体验。
3. 作为中文用户，我希望 `zh_TW`、`zh_HK`、`zh` 等任意 `zh*` 标签都落到中文，以便不必精确设置地区。
4. 作为用户，我希望 `LANG` 未设、为 `C` 或 `POSIX` 时得到英文，以便在最小化环境（容器、CI 终端）中有确定行为。
5. 作为用户，我希望 `LC_ALL` 优先于 `LC_MESSAGES`、`LC_MESSAGES` 优先于 `LANG`，以便符合 gettext 惯例。
6. 作为系统语言是英文但想用中文界面的用户，我希望在 `~/.neant/settings.json` 写 `"locale": "zh-CN"` 覆盖环境变量，以便不改系统 locale。
7. 作为用户，我希望 settings 的 `locale` 写成不支持的语言（如 `fr`）时回退到环境变量解析结果再回退 `en`，而不是报错退出，以便配置错误不阻断使用。
8. 作为团队成员，我希望项目级 `.neant/settings.json` 里的 `locale` 被忽略并给出 warning，以便同事的语言偏好不强加给我。
9. 作为英文用户，我希望状态栏的权限模式名称、说明、`shift+tab` 提示、缓存命中率、`esc` 中断提示为英文。
10. 作为英文用户，我希望审批对话框的标题、问题、三个选项（允许一次 / 本 session 一直允许此工具 / 拒绝）和按键提示为英文。
11. 作为英文用户，我希望"回到底部"徽标、上下文用量警告、窗口过小提示为英文。
12. 作为英文用户，我希望 activity 行的思考、等待、工具动作、完成、失败、夜间、周末、节日、彩蛋、续跑、压缩、评审、审批等句子为英文，并保留原来的趣味风格。
13. 作为英文用户，我希望 activity 结构性文案（完成前缀、工具计数、连击 `x{n}`、总耗时、想/干耗时）为英文，且工具计数单复数正确（`1 tool` / `2 tools`）。
14. 作为英文用户，我希望耗时格式（如 `1m 05s`）按 locale 呈现。
15. 作为英文用户，我希望模型写出的 `⏵` 状态行是英文，以便 activity 行不出现中英混杂。
16. 作为中文用户，我希望模型写出的 `⏵` 状态行仍是中文。
17. 作为任一 locale 的用户，我希望节日和春节彩蛋在同一天触发，只是文案换成我的语言。
18. 作为中文用户，我希望"上下文已压缩"、"MCP server 出错"、settings warning、argv 参数错误、"需要交互式终端"等目前是英文的提示也变成中文，以便界面不中英混杂。
19. 作为中文用户，我希望 ripgrep 不可用时看到中文的修复指引；作为英文用户看到英文指引。
20. 作为用户，我希望 Agent Core 报出的"未配置模型""未知模型""缺少 API key""session 不存在"按我的 locale 显示。
21. 作为用户，我希望没有错误码的 Agent Core 错误仍原样显示其英文消息，而不是空白或 key 名，以便未覆盖的错误不丢信息。
22. 作为在中文 TUI 开始、在英文环境恢复 session 的用户，我希望 transcript 里没有中文界面文案（拒绝消息等），以便模型上下文与界面语言无关。
23. 作为模型，我希望工具被拒绝时收到英文的、稳定的拒绝原因，以便理解与 locale 无关。
24. 作为开发者，我希望在 TUI 字典里新增 key 时，en 漏写或多写 key 在 `tsc -b` 时报错。
25. 作为开发者，我希望 zh 与 en 同一 key 的占位符集合不一致时测试失败，以便插值不会漏参数。
26. 作为开发者，我希望在字典与句池文件之外写中文硬编码时测试失败，以便新文案不会绕过 i18n。
27. 作为开发者，我希望 TUI 字典试图覆盖通用文案的 key 时类型报错，以便同一概念跨端叫法一致。
28. 作为桌面端开发者，我希望直接复用 `@neant/i18n` 的 `resolveLocale`、`createI18n`、通用文案和 `fmtDuration`，只需传入 `navigator.languages` 和自己的字典。
29. 作为开发者，我希望 `t()` 的 key 与参数有类型推断和补全，以便写错 key 在编译期发现。
30. 作为开发者，我希望 activity 句池文件与上游 dsh-working-activity 布局一致，以便后续逐段对照合并上游更新。
31. 作为 Headless CLI 用户，我希望 text / stream-json 输出不受 locale 影响，以便脚本解析稳定。

## Implementation Decisions

**`@neant/i18n`（新包，`packages/i18n`）**

- 与 `@neant/shared` 相同的约束：纯函数，无 `Bun.*`、`node:*`、DOM API；依赖仅允许 `@neant/shared`（用于错误码类型）。不读取环境变量或 settings，候选由 frontend 传入。
- `Locale` 类型为 `"zh" | "en"`，`SUPPORTED_LOCALES` 常量。
- `resolveLocale(candidates: (string | undefined)[]): Locale`：按顺序取第一个可识别的候选；空串、`C`、`POSIX`（含 `C.UTF-8` 之类）跳过；按 BCP 47 / POSIX 标签的语言子标签匹配（`zh_CN.UTF-8`、`zh-Hant`、`en-GB` 均可）；都不匹配返回 `en`。
- 字典形状：以 zh 为基准的 `Record<key, string>`，en 用 `satisfies Record<keyof typeof zh, string>` 约束。占位符为 `{{name}}`。英文复数照 dsh 用 `-one` / `-many` 两个 key，由调用方按数量选择，不引入 `Intl.PluralRules`。
- `createI18n(locale, { common, app })` 返回 `t(key, params?)`。key 为通用文案与 app 字典的并集；app 字典与通用文案 key 重叠时类型报错。运行时缺 key 返回 key 本身（兜底，类型层面不应发生）。
- 通用文案（跨端概念）：三种 Permission Mode 的名称与说明（含紧凑版）、三个审批选项、错误码文案。
- `fmtDuration(ms, locale)`：从 TUI activity 迁入，按 locale 输出。
- 不做运行时切换、订阅、持久化。

**`@neant/shared`**

- 新增用户可见错误码联合类型与带码错误的形状：`{ code, params }`，Agent Core 抛出的 Error 附带 `code` 与 `params`，`message` 为英文。
- 本 spec 覆盖的错误码：`ripgrep-unavailable`（参数 cause）、`no-model`（参数 settings 路径）、`unknown-model`（参数 model）、`no-api-key`（参数 provider、env）、`session-not-found`（参数 id）。
- `SettingsSchema` 新增可选 `locale: string`（BCP 47 标签，不做枚举校验，以便不支持的值走回退而非报错）。

**Agent Core（`@neant/agent`）**

- 上述五处错误改为带码错误，`message` 固定英文。
- 权限拒绝返回给模型的 reason 改为英文（auto-review 下用户拒绝、未授权两种）。
- 配置合并：项目级 settings 的 `locale` 被忽略并产生 warning，与现有 `providers` 处理方式一致。
- 不引入任何 locale 相关参数或依赖 `@neant/i18n`。

**TUI（`@neant/neant-tui`）**

- 新增 TUI 的 i18n 模块：TUI 字典（zh 基准 + en）、启动时解析的 locale 常量与 `t`。locale 候选顺序：用户级 settings `locale`、`LC_ALL`、`LC_MESSAGES`、`LANG`。
- `main` 的 io 新增 `env` 注入（缺省 `process.env`），与现有 `term` 注入方式一致；locale 在 settings 加载后、渲染前确定一次。
- argv 解析早于 settings 加载，其报错只按环境变量解析 locale。
- 替换所有用户可见硬编码文案，包括现有中文与英文两类：状态栏（模式说明、切换提示、缓存、中断、分段名 system/prompt/assistant/thinking/tools 及缩写、`ctx`、`tps`）、审批对话框、回到底部徽标、上下文警告、窗口过小提示、compaction 通知、MCP server 错误通知、settings warning 前缀、argv 校验错误、非交互终端提示。zh 中原本就是英文的技术缩写（`ctx`、`tps` 等）可在 zh 字典中保持原值。
- 权限模式与审批选项使用通用文案，TUI 不另定义。
- 展示 Agent Core 错误时：带码的查通用文案；不带码的显示原 `message`。
- narration 状态行指令改为字典项，按 locale 注入 zh / en 两版；en 版照 dsh-working-activity `lang.ts` 的英文指令。
- activity 句池：沿用单文件布局，每个中文池后紧跟 `EN_` 前缀的英文镜像，与 dsh-working-activity 0.5.1 对齐。能与上游对应的池子照搬上游 `EN_*`；Neant 独有的 `REVIEW_PHRASES` 与比上游多出的 `ACTION_MAP` 条目自写英文。取句函数按启动时 locale 常量选择池子，而非每次探测。节日与春节日期表两种 locale 共用。保留 BSD 版权头与"Adapted from dsh-working-activity 0.5.1"来源说明。
- activity 结构性文案（完成前缀、工具计数单复数、连击、总耗时、想/干耗时摘要）进 TUI 字典，key 与上游 `lang.ts` 对齐。

**Headless CLI**：不改。

## Testing Decisions

好的测试只验证外部行为：给定 locale 候选 / settings / 环境变量，用户看到什么文本、模型收到什么文本，不断言内部函数调用或字典结构。

- **`@neant/i18n` 单元测试**（`bun:test`，`packages/i18n/tests/`）：`resolveLocale` 的优先级、`C`/`POSIX`/空值跳过、各种标签形态匹配、回退 `en`；`t` 的插值与缺 key 兜底；`fmtDuration` 两种 locale 输出；通用文案 zh / en 占位符集合一致。
- **TUI 字典与句池一致性测试**：TUI 字典每个 key 的 zh / en 占位符集合一致；每个中文句池都有非空的 `EN_` 镜像。
- **硬编码扫描测试**：扫描 TUI 源码，字典与句池文件之外出现 `\p{Han}` 即失败。英文硬编码无法静态区分，靠本 spec 的替换清单与 e2e 覆盖。
- **TUI e2e**：沿用现有 `start()` 帮助函数（虚拟终端 + 可控假模型），通过新的 `env` 注入与 `prepare` 写入的临时用户 settings 驱动 locale。覆盖：`LANG=en_US.UTF-8` 与 `zh_CN.UTF-8` 下状态栏、审批对话框、activity 行、narration reminder 文本；settings `locale` 覆盖环境变量；项目级 `locale` 被忽略；`LANG=C` 回退英文。现有 e2e 中对中文文案的断言改为显式设置 zh 环境。先例：`tests/e2e/narration.test.ts`、`tests/e2e/permissions.test.ts`、`tests/e2e/status-line.test.ts`。
- **Agent Core**：在现有 session 与 tools 测试中断言拒绝 reason 为英文、上述五种错误带正确 `code` 与 `params`、项目级 `locale` 产生 warning。先例：`packages/agent/tests/e2e/permissions.test.ts`、`tests/e2e/tools.test.ts`、`tests/config/settings.test.ts`。

## Out of Scope

- zh / en 以外的语言、语言包插件。
- 运行中切换 locale（`/lang` 命令、热更新）。
- CLI flag 指定 locale。
- Headless CLI 的本地化。
- 桌面端接入（只保证 `@neant/i18n` 可被复用）。
- 无错误码的 Agent Core 错误本地化（settings JSON / schema 校验细节、MCP 配置解析、skill frontmatter warning 等仍为英文）。
- 模型回复语言控制（与 locale 无关，跟随用户输入）。
- 数字、日期的 `Intl` 本地化格式（`fmtDuration` 之外）。
- 英文硬编码的静态检测。

## Further Notes

- 决策依据：`CONTEXT.md` 的 **Locale** 条目；`docs/adr/0008-locale-agnostic-agent-core.md`；`docs/tech-stack.md` 中"国际化：自研"。
- 参考实现：dsh-working-activity 0.5.1（`~/.dsh/profiles/dsh-tui/node_modules/dsh-working-activity/src/phrases.ts`、`lang.ts`）提供中英双池与结构性文案；deepseek-harness 的 `dsh-client-locale` 共享包 + 各 UI 包 `locales.ts` 提供"通用 + 各端"拆分先例。
- 新增 `packages/i18n` 后需更新 `CLAUDE.md` 的 Repo layout 与 `docs/tech-stack.md`。
- 现有 e2e 大量断言中文文案，测试环境默认会解析成 `en`；`start()` 帮助函数宜默认注入 zh 环境以减少改动，en 用例显式覆盖。
