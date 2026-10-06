Status: resolved

# Spec: 图片输入

来源：[图片输入](../agent-core-roadmap/issues/18-image-input.md)；缩略图、预览浮层、悬停预览卡归 [终端图形协议（kitty 缩略图与预览）](../agent-core-roadmap/issues/21-terminal-graphics.md)。术语见 `CONTEXT.md` 的 Session、Run、Transcript、Context Usage、Session Title。参考：dsh-TUI `components/PromptInput.tsx`、`dsh-adapter/channel/composer-images.ts`、`utils/clipboard.ts`、`utils/pastedImagePath.ts`；pi-agent-core read 工具；pi-ai 非视觉模型降级。

## Problem Statement

我想让 agent 看一张截图（报错弹窗、UI 走样、设计稿），现在只能把图存成文件、在 prompt 里写路径，期待模型想到用 read 去读。TUI 里 Ctrl+V 粘不进图片，从 Finder 拖进来的只是一串路径文本。即使模型读了图片，session 也不知道这张图有多大，Context Usage 把它算成 0；自定义 provider 的模型永远被当作不支持图片，图片被悄悄换成占位文本，我却看不到任何提示。

## Solution

在 TUI 输入框里按 Ctrl+V 粘贴剪贴板图片，或把图片文件拖进终端，输入框出现一个 `[Image #N]` token；发送时图片随 prompt 一起交给模型。token 像一个字符一样整体移动和删除。transcript 中 user 消息下方显示图片占位 `[Image · name]`，点击用系统查看器打开原图（终端支持图形时由后续工单换成缩略图）。read 读到图片文件时同样把图片交给模型。图片过大时明确拒绝；当前模型不支持图片时提示我，图片仍保存在 transcript 中，切换到视觉模型后可用。Context Usage 计入图片。Headless CLI 不新增入口，在 prompt 里写图片路径由模型 read。

## User Stories

1. As a TUI user, I want to paste a screenshot from the clipboard with Ctrl+V, so that the agent sees it without me saving a file.
2. As a TUI user, I want to drag an image file into the terminal and have it attached, so that I don't have to type its path.
3. As a TUI user, I want a pasted path to an image to become an attachment only when the whole paste is exactly one image path, so that ordinary text pastes containing paths are left alone.
4. As a TUI user, I want quoted, backslash-escaped, `~/`, and `file://` paths recognized, so that whatever my terminal or file manager produces works.
5. As a TUI user, I want a pasted image path that can't be read inserted as plain text, so that I don't lose what I pasted.
6. As a TUI user, I want files copied in Finder to paste as attachments when they are images, so that copy-paste from the file manager works.
7. As a TUI user, I want non-image files copied in Finder to paste as their paths, so that I can still reference them in text.
8. As a TUI user, I want Ctrl+V to paste clipboard text when there is no image, so that the shortcut does what I expect.
9. As a TUI user, I want a notice when the clipboard is empty or unreadable, so that I know why nothing happened.
10. As a TUI user, I want a `[Image #N]` token inserted at the cursor, so that I can refer to the image in my prompt.
11. As a TUI user, I want the token shown in the suggestion color, so that I can tell it apart from typed text.
12. As a TUI user, I want the cursor never to land inside a token, so that I can't half-edit it.
13. As a TUI user, I want Backspace at the end of a token or Delete at its start to remove the whole token, so that removing an image is one keystroke.
14. As a TUI user, I want a selection touching a token to cover the whole token, so that cut and delete never leave fragments.
15. As a TUI user, I want deleting a token to detach its image, so that only images still in the text are sent.
16. As a TUI user, I want typing `[Image #3]` by hand not to attach anything, so that literal text stays literal.
17. As a TUI user, I want token numbers to keep increasing within a Session, so that "Image #2" always means the same image in this conversation.
18. As a TUI user, I want numbering reset after `/new`, resume, rewind, or model switch, so that numbers restart with the new context.
19. As a TUI user, I want a notice "Pasted image [Image #N]" on success, so that I know the image is attached.
20. As a TUI user, I want a clear notice when the clipboard image format is unsupported (e.g. TIFF), so that I know to convert it.
21. As a TUI user, I want an image over 5 MB or over 8000 px on either side refused with a notice, so that a request isn't rejected by the provider later.
22. As a TUI user, I want a notice when the current model doesn't accept images, so that I know the model won't see it.
23. As a TUI user, I want the image kept anyway on a text-only model, so that switching to a vision model with `/model` lets it be used.
24. As a TUI user, I want images sent in the order their tokens appear, so that "Image #1" and "Image #2" match what the model receives.
25. As a TUI user, I want the token text kept in the sent prompt, so that the model can match my references to images.
26. As a TUI user, I want a sent message to show `[Image · name]` below its text, so that I can see which images were attached.
27. As a TUI user, I want clicking an image placeholder to open the original in the system viewer, so that I can look at it.
28. As a TUI user, I want an image read by the read tool shown the same way below its tool card, so that I can see what the agent looked at.
29. As a TUI user, I want images visible again after resume, so that history is complete.
30. As a TUI user, I want steering a running agent with an image to work, so that I can show it something mid-run.
31. As a TUI user, I want paste and token behaviour to work in small terminals and after resize, so that wrapping never splits a token.
32. As a TUI user, I want all image notices localized in zh and en, so that the UI matches my locale.
33. As a model, I want read on a png/jpeg/gif/webp file to return the image, so that I can inspect screenshots in the repo.
34. As a model, I want read on an oversized image to return a clear error, so that I don't send a request the provider will reject.
35. As a Headless CLI user, I want to mention an image path in my prompt and have the model read it, so that scripted runs can use images without new flags.
36. As a user with a custom provider, I want to declare a model's `input` as `["text","image"]` in settings, so that my vision model receives images.
37. As a user with a custom provider, I want models without `input` to default to text only, so that existing settings keep working.
38. As a user, I want invalid `input` values rejected with a settings error, so that typos don't silently disable images.
39. As a user, I want Context Usage to count images, so that the context meter reflects what I actually sent.
40. As a user, I want provider-reported usage to override the image estimate, so that the meter is exact when possible.
41. As an SDK consumer, I want `run(prompt, { images })` and `steer(prompt, { images })`, so that any frontend can attach images.
42. As an SDK consumer, I want invalid images passed to `run` rejected before the Run starts, so that bad input fails fast.
43. As a hook author, I want UserPromptSubmit to receive the prompt text only, so that hook input stays small and compatible with Claude Code.
44. As a user, I want the Session Title generated from text only, so that titles stay cheap.
45. As a user, I want compaction to keep working with images in the Transcript, so that long sessions with screenshots don't break.
46. As a subagent user, I want subagents' read of images to work the same way, so that delegated tasks can inspect images.
47. As a maintainer, I want clipboard and external-open behind injected host functions, so that TUI tests don't touch the real clipboard or launch apps.
48. As a maintainer, I want image size limits and header parsing in one place shared by read and `run`, so that both paths refuse the same images.

## Implementation Decisions

- **共享图片检查（Agent Core 一个领域目录，如 `images`）**：从文件头读出 mime（png/jpeg/gif/webp，按 magic bytes，与 pi read 一致）与宽高；拒绝超过 5 MB 或任一边超过 8000 px 的图片，错误带具体原因。read 工具与 `run` / `steer` 共用；TUI 粘贴时也调用它（经 `@neant/agent` 导出），以便在暂存时就给出 notice。宽高用于 Context Usage 估算与 TUI 占位。不缩放、不加解码依赖。
- **read 工具**：沿用 pi 内置的图片读取（`autoResizeImages` 不生效，因为不注入 imageProcessor）；在 Neant 的工具包装层于执行前对图片文件跑共享检查，超限返回工具错误。bmp 保持 pi 现有行为（返回"需 imageProcessor"文本）。
- **Session API**：`run(prompt, options?)` 与 `steer(prompt, options?)` 的 options 增加 `images?: Array<{ data: string; mimeType: string; name?: string }>`（base64）。Agent Core 在 Run 开始前对每张图跑共享检查，任一失败则拒绝该调用、不开始 Run。user 消息内容为 `[{ type: "text", text: prompt }, ...images]`，图片按传入顺序附在文本之后；`name` 不发给模型，仅存于消息上供 frontend 显示（保存在 user 消息的自定义字段上，`convertToLlm` 时剥离）。
- **存储**：图片以 pi 原生 base64 内联写入 Transcript，resume、compaction、子代理不改。Transcript 中 user 消息的取文本逻辑（hooks、Session Title、输入历史）继续只取 text 块。
- **compaction**：摘要请求如何处理图片沿用 pi 行为；实现时确认 pi 的 compaction 序列化不会把 base64 当文本塞进摘要请求，若会则在 Neant 侧把图片替换为 `[image]` 后再摘要。
- **UserPromptSubmit hook**：输入仍为 prompt 文本，不含图片。`updatedPrompt` 之类的改写只改文本，图片保留。
- **自定义 provider 模型**：settings 中自定义模型 schema 增加可选 `input`，取值为 `"text" | "image"` 组成的非空数组且必须含 `"text"`，缺省为 `["text"]`；非法值按现有 settings 校验报错。内置模型沿用 pi-ai 数据。`listModels` 结果增加 `input`，供 frontend 判断。
- **非视觉模型**：Agent Core 不拦截，照常存图；发请求时由 pi-ai 将图片换成占位文本。
- **Context Usage**：user 与 toolResult 中的 image 块按 `ceil(w*h/750)` 估算，单张上限 1,600；宽高从 base64 文件头解出，解析失败按 1,600。归入现有类别（user 归 prompt，toolResult 归 tools），Context Report 同步。provider 报告的实际 inputTokens 照旧优先。
- **TUI 宿主注入点**：TUI `main` 的 io 增加 `host: { readClipboard(): Promise<ClipboardContent>; openExternal(path: string): Promise<void> }`，默认实现为真实命令。`ClipboardContent` 为 `{ files: string[] } | { image: { path: string } } | { text: string } | { empty: true } | { unavailable: true }`。现有 question 对话框的 Ctrl+V 改走 `readClipboard`（取 text 分支），旧的纯文本读取函数删除。
- **剪贴板默认实现**：macOS 用 `osascript` 依次取 `«class furl»`（文件）、`«class PNGf»`（图片，写入 0700 私有临时目录下的 0600 文件）、再 `pbpaste` 取文本；Linux 依次 `wl-paste --list-types` / `xclip -t TARGETS` 选 `text/uri-list`、`image/png`、文本；Windows 只取文本（沿用现状）。临时文件在 TUI 退出时清理。
- **粘贴路径识别**：bracketed paste 的整段内容去掉首尾空白后，若恰为一个本地路径（单/双引号包裹、反斜杠转义空格、`~/` 开头或绝对路径、`file://` URL；长度 ≤ 4096）且扩展名为 png/jpg/jpeg/gif/webp，则读取并暂存为图片；读取或检查失败时原文照插，不提示。否则按普通粘贴。
- **Composer token（TUI 输入组件）**：
  - 暂存成功插入 `[Image #N] `（带尾随空格）；token 只在绑定了暂存图片时才是 token，按 `suggestion` 主题色渲染。
  - 光标移动吸附到 token 边界（按移动方向，无方向取较近一侧）；Backspace 在 token 末尾、Delete 在 token 起点整删；选区边缘落入 token 内时向外扩展；自动换行不在 token 内断开。
  - 文本中不再含某 token 时解绑，之后手打同文不重新绑定。
  - 编号：Session 内单调递增，跳过草稿中已存在的编号；`/new`、resume、rewind、切换模型时重置为 1 并清空暂存。
  - 发送：按 token 在文本中出现的顺序收集图片，调用 `run` / `steer` 的 `images`；文本原样保留 token 字面量。
  - 输入历史（上下键）只恢复文本，恢复出的 token 不绑定图片。
- **提示文案**（`@neant/i18n`，zh / en 同步）：`Pasted image {{token}}`；`Clipboard is empty`；`Failed to read the clipboard`；`Clipboard is unavailable`；`Could not paste image: {{err}}`（err 为共享检查的原因，同样本地化）；`Clipboard image format is unsupported; use PNG, JPEG, WebP, or GIF`；`{{model}} does not accept images; they will be omitted`。成功提示普通色约 2.5 s，失败提示 warning 色约 5 s，沿用现有 notice 组件。模型不支持图片的提示在粘贴时与切换模型时（草稿或 transcript 有图片）各显示一次。
- **transcript 呈现**：user 消息文本保留 `[Image #N]` 字面量、无 chip；文本下方每张图一行 dim `[Image · name]`（无 name 时 `Image`，name 截断到 80 列）；read 工具卡下方同样显示。点击某行调用 `openExternal`：先把 base64 导出到 0700 私有临时目录的 0600 文件，再交给系统查看器（`open` / `xdg-open`）；失败时 warning notice。这一行是 [终端图形协议（kitty 缩略图与预览）](../agent-core-roadmap/issues/21-terminal-graphics.md) 的降级形态与挂载点。
- **Headless CLI**：不改。

## Testing Decisions

- **好测试**：只测外部行为。Agent Core 观察模型请求中的 content 块、工具结果、`run` 的拒绝、Context Usage 与 resume 后的 Transcript；TUI 观察终端画面、notice、光标位置与传给 Session 的 images。不测文件头解析函数、token 区间计算等内部结构。
- **Agent Core e2e**（`bun:test`，`createSession` + `fakeModel` + `tempDirs`，新文件如 `tests/e2e/images.test.ts`）：
  - `run(prompt, { images })`：模型请求的 user 消息为文本加按序图片；`steer` 同理；`name` 不出现在模型请求中。
  - 超 5 MB、超 8000 px、非图片数据传给 `run` → 调用被拒、无模型请求。
  - read png/jpeg/gif/webp → 工具结果含 image 块；超限 → 工具错误。
  - 自定义模型 `input: ["text","image"]` 时图片到达请求；缺省时请求中为 pi-ai 占位文本。
  - Context Usage：带一张 100×100 图片的 prompt 估算增加约 14；超大图封顶 1,600；有 provider 用量时以其为准。
  - resume 后 Transcript 中图片仍在，下一次请求仍带图片；compaction 后正常继续且摘要请求不含 base64 文本。
  - UserPromptSubmit hook 收到的 prompt 为纯文本；Session Title 只用文本。
  - 子代理 read 图片可用。
- **settings 单测**（追加到 `packages/agent/tests/config/` 现有 settings 测试）：`input` 合法值、缺省、非法值（空数组、缺 `"text"`、未知值）报错；`listModels` 带 `input`。
- **TUI e2e**（`start` + headless terminal，注入 `host`，新文件如 `tests/e2e/images.test.ts`）：
  - Ctrl+V：`readClipboard` 返回 image → 插入 `[Image #1] ` 与成功 notice；返回 files（图片 + 非图片）→ 图片成 token、非图片插入路径；返回 text → 插入文本；empty / unavailable → 对应 notice；格式不支持 → notice。
  - bracketed paste 一个临时 PNG 的绝对路径、带引号路径、`file://` 路径 → token；不存在的路径、多行文本含路径 → 原文插入。
  - token 原子性：左右移动跨越整个 token；Backspace / Delete 整删；删除后发送不带图片；手打 `[Image #1]` 发送不带图片。
  - 编号：连续粘贴为 #1、#2；删除 #1 后再粘贴为 #3；`/new` 后重置为 #1。
  - 发送：Session 收到的 images 顺序与 token 顺序一致；transcript 显示 `[Image · name]`；点击调用 `openExternal`。
  - 超限图片 → warning notice、不插入 token。
  - 当前模型不支持图片 → 粘贴后显示提示，token 仍插入。
  - 小终端（40×12）与 resize 后 token 不被换行拆开。
  - question 对话框 Ctrl+V 经注入的 `readClipboard` 仍可粘贴文本。
- **参考先例**：Agent Core `tests/e2e/tools.test.ts`（内置工具结果）、`context-usage.test.ts`、`session-recovery.test.ts`（resume）、`compaction.test.ts`；TUI `tests/e2e/questions.test.ts`（Ctrl+V 粘贴）、`tools-and-notices.test.ts`（notice 断言）、`fullscreen.test.ts`（小终端与 resize）、`resume.test.ts`。
- 剪贴板默认实现（osascript / wl-paste / xclip 解析）不做自动化测试，实现时在 macOS 手动验证并记录在工单中。
- Headless CLI 不加测试：无新入口。

## Out of Scope

- 缩略图、图片预览浮层、输入框悬停预览卡：归 [终端图形协议（kitty 缩略图与预览）](../agent-core-roadmap/issues/21-terminal-graphics.md)。
- `@路径` 文件提及与补全。
- sixel / iTerm2 图形协议。
- 图片缩放与格式转换（sharp）；bmp / tiff 支持。
- 内容寻址附件存储（transcript 只存引用）。
- Headless CLI `--image` 与 stream-json 输入。
- Windows 剪贴板图片。
- Alt+V 别名与 `/settings` 改键。

## Further Notes

- 5 MB / 8000 px 取自 Anthropic 的单图上限，是所有 provider 里较宽的一档；其他 provider 更严时由其返回错误，届时再按模型的 `inputLimits` 细化。
- base64 内联会让 session 文件增大（每张截图约 1–4 MB）；若成为问题，换成内容寻址附件只改存储层，Session API 不变。

## Implementation Evidence

2026-10-06：01–08 已按依赖关系实现并合入 `codex/image-input`；最终代码集成提交 `2977ae3144bb642444e877cd326f9002d0663538`。Session/run/steer、read 限额、Context Usage、自定义模型能力、TUI host、路径与剪贴板粘贴、原子 token、图片占位与系统查看器、非视觉提示完成。Headless CLI 沿用模型 read 入口。

[双轴审查与修复验收](review.md)：Standards 的 2 项规范违约与 2 项判断项全部修复；Spec 的长模型名布局问题已修复，未发现额外缺口或范围扩张。用户提示使用 shared 错误契约，模型工具文本保留英文。

最终 `rtk proxy caffeinate -is env -u NO_COLOR bun run check` exit 0：格式、lint、类型、Knip 与 **2095 tests / 0 fail / 10324 assertions / 152 files** 全部通过（244.39 s）。macOS 真实剪贴板验证及恢复证据见 [07](issues/07-ctrl-v-clipboard.md)。各票保留 focused、red→green 与实施证据。

01–08 与最终审查修复工作树全部按 clean/merged 校验后归档。后续已按用户要求合入 main，并删除集成工作树及已合并分支；规格与各票均为 resolved。

2026-10-06 main 集成提交 `9e7c599b87d2b32cc35df3af713912eb0f9aec91`；合并后全量检查 exit 0，**2153 tests / 0 fail / 11065 assertions / 153 files**。冲突处理、两项功能共存与清理证据见 [main 集成验收](review.md#main-集成与清理)。

2026-10-06 后续 [消息流图片预览](../image-message-preview/spec.md) 已交付并合入 main `9e895a2`。消息图片点击现在打开 TUI 内部预览，只有卡片中的“打开原图”启动系统查看器；当前使用契约见 [Neant TUI README](../../apps/neant-tui/README.md)。Kitty PNG 缩略图、画廊、缩放/平移和消息区预览由此次后续规格拥有；输入 token 悬停预览仍归路线图 21。

2026-10-06 后续 [剪贴板图片 Tips](issues/09-clipboard-image-tip.md) 已合入 main `4277f5c`。右下角按 locale 显示图片可粘贴提示，剪贴板变化后自动更新；不导出图片，不改变既有粘贴入口与通知优先级。main aggregate 2193 pass / 0 fail，双轴审查及清理见 [后续验收](review.md#剪贴板图片提示后续验收)。
