# 18: 图片输入

Type: grilling
Status: resolved
Blocked by: None

## Question

用户如何把图片交给模型，read 工具能否读图片？

需定：TUI 输入方式（粘贴剪贴板图片 / 拖入路径 / `@路径`）及终端能力限制；read 工具读到图片文件时返回图片内容；模型不支持视觉时的降级（models.dev 能力字段）；图片在 transcript 中的存储（内联 base64 / 外部文件引用）与 Context Usage 计量；Headless CLI 输入方式。

## Answer

2026-10-06 grilling 结论。参考：dsh-TUI `components/PromptInput.tsx`、`dsh-adapter/channel/composer-images.ts`、`utils/clipboard.ts`、`utils/pastedImagePath.ts`、`components/messages/TranscriptImages.tsx`；deepseek-harness `packages/attachment`；pi-agent-core `harness/tools/read.js`、pi-ai `api/transform-messages.js`。

事实：pi read 已按 magic bytes 识别 png/jpeg/gif/webp 并返回原始 base64（无缩放、无上限）；pi-ai 对 `input` 不含 `image` 的模型把图片换成占位文本；Neant `Session.run` 只收字符串、自定义 provider 模型硬编码 `input: ["text"]`、Context Usage 把图片算 0、TUI 剪贴板只读文本。

1. **TUI 输入：** 照 dsh-TUI，Ctrl+V 读剪贴板，顺序为复制的文件 → 图片 → 文本；粘贴内容整段恰为一个无歧义的本地图片路径（引号、转义、`file://`、`~/`）时直接转 token、无确认，读取失败原文照插不提示。剪贴板只做 macOS（osascript 导出到 0700 临时目录）与 Linux（wl-paste / xclip）；Finder 复制的非图片文件插入路径文本。不做 Alt+V 别名、`/settings` 改键、Windows。
2. **存储：** 照 pi 默认，图片以 base64 内联存于 transcript；resume / compaction / 子代理不改。session 文件变大成问题时再换内容寻址附件（只改存储）。
3. **尺寸：** 不缩放、不加原生依赖。超 5 MB 或文件头宽高超 8000 px 拒绝：TUI 粘贴时 notice，read 工具返回错误。
4. **非视觉模型：** 自定义 provider 模型 schema 加 `input?: ("text"|"image")[]`，默认 `["text"]`。TUI 不拦截粘贴，插入 token 并 notice 提示当前模型不支持图片、发送时会省略；transcript 保留图片，`/model` 切换后可用。降级交给 pi-ai 占位。
5. **Session API：** `run(prompt, { images })`、`steer(prompt, { images })`，图片按序附在文本之后；`[Image #N]` 保留在文本中供模型对号。UserPromptSubmit hook 与 Session Title 只用文本。
6. **Context Usage：** 按文件头宽高 `w*h/750` 估算，单张上限 1,600；provider 报告实际 inputTokens 时以其为准。
7. **Headless CLI：** 不加图片输入，prompt 里写路径由模型用 read 读。
8. **输入框 token：** 照 dsh-TUI：`[Image #N]`、`suggestion` 色；原子光标（不进入 token 内、Backspace/Delete 整删、选区扩展）；仅真实粘贴的 token 绑定图片，手打同文不算，从文本删掉即解绑；编号 session 内递增，`/new` / resume / rewind / 切模型重置。
9. **提示文案：** 照 dsh 英文（`Pasted image [Image #N]`、`Clipboard is empty`、`Could not paste image: …`、格式不支持），zh / en 同步（ADR-0008）；另加 Neant 自有的"当前模型不支持图片"notice。
10. **transcript 呈现：** 发送后的 user 文本保留 `[Image #N]` 字面量、无 chip。user 消息与 read 工具卡下方显示图片；无图形能力时为 dim `[Image · name]` 占位，点击用系统查看器（`open` / `xdg-open`）打开原图。
11. **缩略图 / 预览浮层 / 悬停预览卡：** 做，照 dsh-TUI；另开 [终端图形协议（kitty 缩略图与预览）](21-terminal-graphics.md)，本工单 spec 只留占位与系统查看器作降级入口，不等它。已定前提：只做 kitty（tmux / screen 内退回占位）；不加解码依赖，PNG 以 `f=100` 直传由终端缩放，非 PNG 显示占位。

Out of scope：`@路径` 文件提及；sixel 与 iTerm2 协议；sharp 缩放与非 PNG 缩略图；Headless `--image`；Windows 剪贴板。

Spec：[图片输入 spec](../../image-input/spec.md)（ready-for-agent）。
