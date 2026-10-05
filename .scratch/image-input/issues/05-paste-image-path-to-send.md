# 05: 粘贴图片路径直到发送

**What to build:** 用户把图片文件拖进终端（bracketed paste 一个图片路径），输入框出现 `[Image #N]` token 并提示已粘贴；发送后模型收到图片，transcript 中 user 消息与 read 工具卡下方显示 `[Image · name]`，点击用系统查看器打开原图。详见 [图片输入 spec](../spec.md) 的粘贴路径识别、Composer token（发送部分）、提示文案、transcript 呈现几节。

**Blocked by:** 01, 04

**Status:** ready-for-agent

- [ ] 整段粘贴恰为一个图片路径（引号、反斜杠转义、`~/`、绝对路径、`file://`，≤ 4096，png/jpg/jpeg/gif/webp）时读取并跑共享检查，成功插入 `[Image #N] `（`suggestion` 色）与成功 notice；读取失败原文照插；超限 warning notice 且不插入
- [ ] 发送时按 token 出现顺序把绑定图片作为 `images` 交给 `run` / `steer`，文本保留 token 字面量
- [ ] transcript：user 消息与 read 工具卡下方每张图一行 dim `[Image · name]`（无 name 用 `Image`，截断 80 列）；resume 后同样显示
- [ ] 点击占位：导出到 0700 私有临时目录的 0600 文件后调用 `openExternal`；失败 warning notice；退出时清理临时目录
- [ ] 文案 zh / en 同步（ADR-0008）
- [ ] TUI e2e：绝对路径、带引号路径、`file://` 成 token；不存在路径、多行文本原样插入；超限 notice；Session 收到的 images 顺序正确；transcript 占位；点击调用注入的 `openExternal`；resume 后占位仍在
