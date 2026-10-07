---
status: accepted
---

# Agent Core 不做本地化，文案由 @rukie/i18n 与各 frontend 字典完成

## 问题

同一个 Session 可以在不同语言的 Frontend 中恢复，领域行为与 Transcript 需要独立于界面语言。

## 决定

Agent Core 不感知 locale。面向用户的错误只产出错误码加参数（如 `{ code: "ripgrep-unavailable", cause }`），码的联合类型放在 `@rukie/shared`；发给模型的文本（拒绝消息等 tool result）固定英文。本地化在 frontend 完成：`@rukie/i18n` 提供运行时无关的 `resolveLocale`、`createI18n` 和通用文案（错误码、permission mode、审批选项等跨端概念），各 frontend 只新增自己的 key、不可覆盖通用 key，并自行读取 locale 候选（TUI 读 settings `locale` 与 `LC_ALL`/`LC_MESSAGES`/`LANG`，桌面端读 `navigator.languages`）。

不让 Agent Core 直接产出本地化文本：transcript 是模型当时看到的原样记录，同一个 session 可能在不同 locale 的 frontend 中恢复，混入 UI 语言会让 transcript 依赖于当时的 frontend；Agent Core 也就得知道 locale 从哪来，破坏它与界面无关的定位。代价是每新增一种用户可见错误，都要在 shared 加码、在通用文案补两种语言。

不允许 frontend 覆盖通用 key：同一概念在 TUI 和桌面端叫法会漂移。TUI 自己注入的模型指令（narration 状态行指令）属于界面文案，按 locale 切换，不受"发给模型固定英文"约束。参考 deepseek-harness 的 `dsh-client-locale` 共享包加各 UI 包 `locales.ts` 的拆分。

### Tool View 延伸

[工具呈现规格](../../.scratch/tool-view/spec.md)将这一边界应用于 Tool View：Core 的纯 presenter 提供命令、路径、URL、diff、退出码和字典键等事实，Frontend 负责标题、分隔符、类别主题与本地化。presenter 不可用或失败时退回原始工具输入、结果的 generic 呈现，不影响执行。

Tool View 不写入 Transcript；实时事件附加 view，Resume 从保存的调用与结果重新投影。工具已不可用时仍可展示原始记录。因此切换 locale 或呈现方式不需要修改执行历史。共享 schema 属于 `@rukie/shared`，Core 不引入终端或 React 依赖。

依据：[i18n 规格](../../.scratch/i18n/spec.md)和[Tool View 规格](../../.scratch/tool-view/spec.md)。

## 备选方案

**Agent Core 直接本地化或 Frontend 覆盖通用文案。** 原记录说明 Core 本地化会让 Transcript 依赖 Frontend 语言；覆盖通用文案会使同一概念在不同 Frontend 中漂移。

## 影响

每新增跨端用户可见错误，需要维护 shared 错误码和两种语言的通用文案。工具扩展需要提供稳定的执行事实；呈现投影保持可重建，Frontend 对历史工具缺失有通用退路。
