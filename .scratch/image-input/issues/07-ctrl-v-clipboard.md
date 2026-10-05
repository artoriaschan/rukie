# 07: Ctrl+V 粘贴剪贴板

**What to build:** 用户在输入框按 Ctrl+V：剪贴板是复制的文件时图片成 token、其他文件插入路径；是图片时成 token；是文本时插入文本；为空、不可用或格式不支持时给出对应提示。详见 [图片输入 spec](../spec.md) 的剪贴板默认实现与提示文案两节。

**Blocked by:** 05

**Status:** resolved

- [x] 输入框 Ctrl+V 调用 `host.readClipboard`，按 files → image → text 分支处理；empty / unavailable / 格式不支持各自 notice
- [x] 默认实现：macOS `osascript` 依次取 `«class furl»`、`«class PNGf»`（写入 0700 临时目录 0600 文件）、`pbpaste`；Linux 按 `wl-paste --list-types` / `xclip -t TARGETS` 选 `text/uri-list`、`image/png`、文本；Windows 只取文本；临时文件退出时清理
- [x] TUI e2e（注入 `host`）：image → token + notice；files（图片 + 非图片）→ token + 路径文本；text → 插入；empty / unavailable / 不支持格式 → notice；question 对话框 Ctrl+V 仍为文本
- [x] macOS 手动验证截图粘贴与 Finder 复制文件，记录在本工单 Comments

## Comments

- 2026-10-06: Ctrl+V 使用现有 `TextInput.filterInput(event, insert)` 的插入 continuation，在光标位置按 files → image → text 处理；图片复用 Composer 的原始字节检查、绑定与发送路径。成功提示复用 `notifyPastedImage`，失败提示保留草稿并同步提供 zh/en 文案。pending read 保留 Session、焦点与卸载的异步所有权检查，question 输入继续使用自己的纯文本分支。
- 默认宿主改为每次 `main` 创建并负责 dispose 的实例。macOS 用 osascript/JXA 读取原生 pasteboard item 的 `public.file-url` 与实际类型，覆盖真实 Finder 多文件；`furl` 作桥接不可用时的后备，PNGf 导出优先于 TIFF，最后 pbpaste。实测 AppleScript `clipboard info` 会列出可转换 PNG，因此使用原生类型区分 TIFF-only，避免转换。Linux 协商 wl-paste / xclip 的 URI、原始图片与文本类型并保留 xsel 后备，Windows 保留文本。进程有 3 s 超时，私有导出目录 0700、文件 0600；退出先停止 Chat，再等待 pending export，移除本实例目录。
- TDD 首个公开 Ctrl+V 图片测试在实现前因无 token / 成功提示而失败；实现后 `image-clipboard.test.ts` 11 tests / 43 assertions 通过，覆盖光标插入、PNG/GIF 混合文件顺序、原样文本、empty / unavailable / throw / TIFF / 大图 / 读失败的双语提示，以及 Session 替换和 question 获得焦点时丢弃晚到结果。图片与 question 相关三文件回归先前为 77 tests / 396 assertions 通过（随后新增一个 clipboard question 用例）；`tsc -b`、局部 oxlint、oxfmt 与 diff 检查通过。完整检查由 integration 统一执行。
- macOS 手动验证使用 AppKit 控制器先物化原剪贴板全部 1 item / 4 flavors，所有 fixture 写入和恢复前检查 changeCount，备份只存于 0700 目录下的 0600 plist。真实 CUA Finder Cmd+A / Cmd+C 复制合成 image.png + note.txt，两条文件 URL 按顺序由默认宿主返回。原生 `screencapture -c -x -l` 只捕获自建纯色测试窗口，产出 PNG+TIFF 412×396；默认 public `main` 的 Ctrl+V 出现 token 与成功 notice，模型收到一个原始 PNG 图片，退出移除导出目录且 stderr 为空。另验证 PNG-only、PNG+TIFF 优先 PNG、TIFF-only 原样导出（unsupported 提示由注入 e2e 覆盖）、保留空白/换行的文本、空剪贴板；0700/0600、并存实例互不删除、dispose 清理均通过。每轮原剪贴板四种格式逐字节恢复成功，截图与 Finder 源文件、私有备份均未留在仓库。系统截图快捷键未改变剪贴板，故截图证据来自实际原生截图生产器，不宣称 Screenshot-app 手势。
- Linux / Windows 命令实现遵循宿主协议，但本机未做跨操作系统手动验证；依 spec 未增加 OS 命令解析器自动化测试。

- 同步 integration `5161ce9`（06 + 08）时保留编辑元数据、history recall、Composer prune/reset 与所有权 guard；Ctrl+V 和路径粘贴都调用 08 的唯一 `notifyPastedImage`，成功提示与模型不支持图片警告使用独立计时器。新增公开 Ctrl+V text-only-model 回归，图片仍发送给 Agent Core；clipboard 文件现在 12 tests / 46 assertions 通过。同步后的 image / clipboard / token / question 四文件为 91 tests / 418 assertions（新增模型 clipboard 用例前），模型 notice 文件为 11 tests / 48 assertions 通过；类型、局部 lint、格式检查通过。
