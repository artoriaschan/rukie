# 08: 非视觉模型提示

**What to build:** 当前模型不接受图片时，用户粘贴图片后 token 照常插入，同时看到"该模型不接受图片、发送时会省略"的提示；切换到这样的模型而草稿或 transcript 中有图片时也提示一次。详见 [图片输入 spec](../spec.md) 的非视觉模型与提示文案两节。

Blocked by: 03, 05

Status: resolved

- [x] 依据 `listModels` 的 `input` 判断当前模型
- [x] 粘贴成功后若模型不接受图片，追加 `{{model}} does not accept images; they will be omitted` notice（zh / en）
- [x] `/model` 切换到不接受图片的模型且草稿或 transcript 有图片时提示一次
- [x] TUI e2e：纯文本模型下粘贴 → token + 提示；视觉模型下无提示；切换模型时提示

## Comments

- 2026-10-06 最终 Standards/Spec 共同发现修复：有效 custom model ID（`custom-` + 300 个 `m`）在 40×12 将提示展开至隐藏 editor/status。公开 `start` 回归先 red 后 green；仅显示标签按终端列宽做 grapheme 截断，保留短 ID 完整文案与提示语义，不限制 settings ID。notice 保存原 model spec，resize 时重新计算显示而不重启独立计时器。新增回归覆盖 40×12 → 80×24 → 40×12，以及发送时模型仍收到原图；短 ID、中文独立 2.5s/5s timers、共存面板与阅读位置回归保持通过。相关 10 文件 142 pass / 0 fail / 700 assertions，静态检查通过；root 负责最终 aggregate。

- Implemented `listModels.input` + current `Session.model` capability checks. Both path paste and clipboard paste share `notifyPastedImage`; successful paste retains the token and 2.5-second confirmation while a text-only model adds a warning in the warning color for 5 seconds. zh/en copy lives in `@neant/i18n`.
- Model switching captures draft/transcript image presence before successful model reset. User and read-tool images remain in the transcript and are submitted normally; the Agent Core wire guard owns omission. Vision models and image-free Sessions do not show the warning.
- `/model` ignores only bound image ranges when parsing its argument; hand-typed labels remain ordinary arguments. Picker opening follows the submit event in a microtask so that Enter does not immediately pick the current model. This adapter preserves the draft-image fact before submit/reset clears bindings.
- Warning text occupies reserved, wrapped rows above the editor. 40×12 and 40×24 public terminal checks preserve Goal/Todo/Subagent panels, paste confirmation, warning, editor and status rows. A history-reading regression preserves the top reading position, visible history rows, new-output indication and return control.
- Red evidence: new public `start` regressions failed because paste/switch warnings were missing; bound `/model` arguments failed as unknown model specs, then exposed same-Enter picker selection. Green evidence: `env -u NO_COLOR bun test` on `image-model-notice`, `images`, `question-panel-parity`, `fullscreen`, `input-history`, `main` and i18n tests passed **163 tests, 794 assertions**. `tsc -b`, focused `oxlint`, focused `oxfmt --check` and `git diff --check` passed. Aggregate verification is performed on integration by the root agent.
