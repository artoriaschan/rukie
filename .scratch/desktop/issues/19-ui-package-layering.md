# 19: packages/ui 的内部分层与边界

Type: grilling

Blocked by: 13, 15

Status: needs-triage

## Question

`packages/ui` 内如何分层：组件、Zustand store、wire client（[10](10-wire-protocol-messages.md#answer)）、host 接口（Electron preload 与浏览器开发模式）；各层的依赖方向、与 `@rukie/shared`/`@rukie/i18n` 的关系、能否 import `@rukie/agent` 类型；用哪种 lint 规则强制边界；SessionEvent 到 UI 状态的归约放在哪里，是否复用 `coding-agent/src/view/` 的逻辑（[01](01-packages-and-effect-boundary.md#answer) 定为不抽取）。
