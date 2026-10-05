# 08: 非视觉模型提示

**What to build:** 当前模型不接受图片时，用户粘贴图片后 token 照常插入，同时看到"该模型不接受图片、发送时会省略"的提示；切换到这样的模型而草稿或 transcript 中有图片时也提示一次。详见 [图片输入 spec](../spec.md) 的非视觉模型与提示文案两节。

**Blocked by:** 03, 05

**Status:** resolved

- [x] 依据 `listModels` 的 `input` 判断当前模型
- [x] 粘贴成功后若模型不接受图片，追加 `{{model}} does not accept images; they will be omitted` notice（zh / en）
- [x] `/model` 切换到不接受图片的模型且草稿或 transcript 有图片时提示一次
- [x] TUI e2e：纯文本模型下粘贴 → token + 提示；视觉模型下无提示；切换模型时提示

## Comments

- Implemented `listModels.input` + current `Session.model` capability checks. Both path paste and clipboard paste share `notifyPastedImage`; successful paste retains the token and 2.5-second confirmation while a text-only model adds a warning in the warning color for 5 seconds. zh/en copy lives in `@neant/i18n`.
- Model switching captures draft/transcript image presence before successful model reset. User and read-tool images remain in the transcript and are submitted normally; the Agent Core wire guard owns omission. Vision models and image-free Sessions do not show the warning.
- `/model` ignores only bound image ranges when parsing its argument; hand-typed labels remain ordinary arguments. Picker opening follows the submit event in a microtask so that Enter does not immediately pick the current model. This adapter preserves the draft-image fact before submit/reset clears bindings.
- Warning text occupies reserved, wrapped rows above the editor. 40×12 and 40×24 public terminal checks preserve Goal/Todo/Subagent panels, paste confirmation, warning, editor and status rows. A history-reading regression preserves the top reading position, visible history rows, new-output indication and return control.
- Red evidence: new public `start` regressions failed because paste/switch warnings were missing; bound `/model` arguments failed as unknown model specs, then exposed same-Enter picker selection. Green evidence: `env -u NO_COLOR bun test` on `image-model-notice`, `images`, `question-panel-parity`, `fullscreen`, `input-history`, `main` and i18n tests passed **163 tests, 794 assertions**. `tsc -b`, focused `oxlint`, focused `oxfmt --check` and `git diff --check` passed. Aggregate verification is performed on integration by the root agent.
