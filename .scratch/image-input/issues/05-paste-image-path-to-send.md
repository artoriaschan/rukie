# 05: 粘贴图片路径直到发送

**What to build:** 用户把图片文件拖进终端（bracketed paste 一个图片路径），输入框出现 `[Image #N]` token 并提示已粘贴；发送后模型收到图片，transcript 中 user 消息与 read 工具卡下方显示 `[Image · name]`，点击用系统查看器打开原图。详见 [图片输入 spec](../spec.md) 的粘贴路径识别、Composer token（发送部分）、提示文案、transcript 呈现几节。

**Blocked by:** 01, 04

**Status:** resolved

- [x] 整段粘贴恰为一个图片路径（引号、反斜杠转义、`~/`、绝对路径、`file://`，≤ 4096，png/jpg/jpeg/gif/webp）时读取并跑共享检查，成功插入 `[Image #N] `（`suggestion` 色）与成功 notice；读取失败原文照插；超限 warning notice 且不插入
- [x] 发送时按 token 出现顺序把绑定图片作为 `images` 交给 `run` / `steer`，文本保留 token 字面量
- [x] transcript：user 消息与 read 工具卡下方每张图一行 dim `[Image · name]`（无 name 用 `Image`，截断 80 列）；resume 后同样显示
- [x] 点击占位：导出到 0700 私有临时目录的 0600 文件后调用 `openExternal`；失败 warning notice；退出时清理临时目录
- [x] 文案 zh / en 同步（ADR-0008）
- [x] TUI e2e：绝对路径、带引号路径、`file://` 成 token；不存在路径、多行文本原样插入；超限 notice；Session 收到的 images 顺序正确；transcript 占位；点击调用注入的 `openExternal`；resume 后占位仍在

## Comments

- 2026-10-06 最终 Standards 审查提取：路径与 clipboard 只共享 read → 所有权检查 → bind → 光标插入 → success/model notice；路径无效/不可读照插原文，clipboard 失败保持草稿并警告。原有退出、Session/焦点转移、rewind/model reset 的 pending 丢弃回归保持通过。viewer 与默认 clipboard 的目录创建、权限、pending 等待和清理复用内部 `createPrivateExports`，各 TUI 资源实例仍分别拥有目录。新增公开 exit + pending external open 测试验证终端先恢复、导出保留 0700/0600 和原字节、open 完成后删除目录。
- 最终修复集中验证 142 pass / 0 fail / 700 assertions，另将 pending-open 字节断言移到公开退出结果后再次单独验证 1 pass / 0 fail / 6 assertions，避免错误被 UI 捕获时掩盖测试失败；静态检查及架构文档同步通过，root 负责最终 aggregate。

- 2026-10-06：在托管 worktree `image-input-05`、分支 `codex/image-input-05`，从已验证的集成基线 `5f20b48` 开始。先通过公开 `start` / headless terminal 重现图片路径仍为原文、占位不可点击及 read 图片无占位，再逐个实现至绿色。
- 路径识别与 draft 绑定由 chat 拥有，共享 `validateImageBytes` 做字节和尺寸检查。run / steer 接收 token 文本顺序的图片；普通 Run 中提交规则保留。缺失、无效、过长和含多段内容的路径照插原文，超限不插入并显示带精确参数的 warning。
- user / read 占位从 Transcript 投影，resume 保持名称、原图与交互；名称按 grapheme 限制 80 列。每个 TUI 的 viewer 独占 0700 目录与 0600 原始字节文件，退出等待自身 pending opens 后清理。
- 成功提示 2.5 秒、warning 5 秒，放在 composer 提示行，在读取历史时仍可见且不改变 ScrollBox 阅读位置。zh/en notice 和共享校验原因在 `@neant/i18n`。异步粘贴在退出、Session 清空或输入所有权转移时丢弃成功及失败结果；FIFO 公共测试覆盖延迟读取。
- renderer 仅增加通用 `onPaste`、`filterInput` 的 insert continuation 和 `highlightRanges`，约束已同步 README；06 的原子编辑与07 的系统剪贴板接入继续由后续 ticket 完成。
- 验证：集中 22 文件 221 用例运行中其余 220 通过；超长文本断言误用已滚出输入窗口的前缀，改为可见尾部后独立回归通过。图片 e2e 27 用例再次整体验证；`tsc -b`、`oxlint`、`knip`、`oxfmt --check` 和 `git diff --check` 通过。最终 aggregate 由主代理在集成后运行。
