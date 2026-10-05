# 08: 非视觉模型提示

**What to build:** 当前模型不接受图片时，用户粘贴图片后 token 照常插入，同时看到"该模型不接受图片、发送时会省略"的提示；切换到这样的模型而草稿或 transcript 中有图片时也提示一次。详见 [图片输入 spec](../spec.md) 的非视觉模型与提示文案两节。

**Blocked by:** 03, 05

**Status:** ready-for-agent

- [ ] 依据 `listModels` 的 `input` 判断当前模型
- [ ] 粘贴成功后若模型不接受图片，追加 `{{model}} does not accept images; they will be omitted` notice（zh / en）
- [ ] `/model` 切换到不接受图片的模型且草稿或 transcript 有图片时提示一次
- [ ] TUI e2e：纯文本模型下粘贴 → token + 提示；视觉模型下无提示；切换模型时提示
