# Agent Core 不做本地化，文案由 @neant/i18n 与各 frontend 字典完成

Status: accepted

Agent Core 不感知 locale。面向用户的错误只产出错误码加参数（如 `{ code: "ripgrep-unavailable", cause }`），码的联合类型放在 `@neant/shared`；发给模型的文本（拒绝消息等 tool result）固定英文。本地化在 frontend 完成：`@neant/i18n` 提供运行时无关的 `resolveLocale`、`createI18n` 和通用文案（错误码、permission mode、审批选项等跨端概念），各 frontend 只新增自己的 key、不可覆盖通用 key，并自行读取 locale 候选（TUI 读 settings `locale` 与 `LC_ALL`/`LC_MESSAGES`/`LANG`，桌面端读 `navigator.languages`）。

不让 Agent Core 直接产出本地化文本：transcript 是模型当时看到的原样记录，同一个 session 可能在不同 locale 的 frontend 中恢复，混入 UI 语言会让 transcript 依赖于当时的 frontend；Agent Core 也就得知道 locale 从哪来，破坏它与界面无关的定位。代价是每新增一种用户可见错误，都要在 shared 加码、在通用文案补两种语言。

不允许 frontend 覆盖通用 key：同一概念在 TUI 和桌面端叫法会漂移。TUI 自己注入的模型指令（narration 状态行指令）属于界面文案，按 locale 切换，不受"发给模型固定英文"约束。参考 deepseek-harness 的 `dsh-client-locale` 共享包加各 UI 包 `locales.ts` 的拆分。
