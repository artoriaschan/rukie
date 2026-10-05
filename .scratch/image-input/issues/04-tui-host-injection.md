# 04: TUI 宿主注入点

**What to build:** 预先重构。TUI 的剪贴板读取与外部打开改为经 `main` 注入的 `host`，测试可替换；用户可见行为不变。详见 [图片输入 spec](../spec.md) 的 TUI 宿主注入点一节。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] TUI `main` 的 io 增加 `host: { readClipboard(): Promise<ClipboardContent>; openExternal(path): Promise<void> }`，默认实现为真实命令；`ClipboardContent` 形状照 spec
- [x] 本工单默认 `readClipboard` 只实现 text / empty / unavailable（沿用现有 pbpaste / powershell / wl-paste / xclip / xsel 文本读取），files 与 image 分支留给 Ctrl+V 粘贴剪贴板工单
- [x] question 对话框 Ctrl+V 改走 `readClipboard`；删除旧的纯文本读取函数
- [x] 测试 `start` helper 支持注入 `host`；现有 question Ctrl+V 测试改用注入并通过

## Comments

- 2026-10-06：在 `codex/image-input-04` 分支实施，基于集成分支 `codex/image-input` 的 `4b58bb1`；测试采用 spec 已确认的 TUI `start` + headless terminal seam。
- 新增 `src/host/index.ts`：`ClipboardContent` 与 spec 一致；`TuiHost` 包含 `readClipboard` / `openExternal`，由 `main` 注入到 chat。默认读取保留原有平台文本命令，只返回 text / empty / unavailable；外部查看器用 argv 调用 open / explorer.exe / xdg-open，非零退出拒绝。
- question Ctrl+V / Alt+V 仅使用 text 分支；非文本结果与拒绝仍显示已有剪贴板错误。异步读取继续保留 request / question generation 保护，尺寸与焦点变化的结果保持原有行为。旧的 `screens/chat/clipboard.ts` 删除。
- `start` 支持注入 host，默认使用无副作用测试 host；剪贴板测试移除 macOS 限制、命令脚本与全局 PATH 改写，改为注入内容与受控 Promise。
- TDD：注入文本用例先失败（原入口忽略 host，禁止宿主命令的 PATH 下显示剪贴板错误），改走 host 后通过；读取拒绝用例先出现未处理错误，统一恢复到已有错误提示后通过。
- 验证：清除 NO_COLOR 的 question-panel-parity / questions / interactions 三文件测试 64 pass / 0 fail；新增四种非文本结果测试 4 pass / 0 fail。`tsc -b`、`oxlint`、`knip`、全仓库 `oxfmt --check`、`git diff --check` 通过。初次未清除 NO_COLOR 的运行出现 3 个现有颜色/hover断言失败，按仓库要求清除后全部通过。
- 完整验证：`env -u NO_COLOR bun run check` 成功退出 0（format → lint → types → Knip → tests），1973 pass / 0 fail，144 个测试文件，9981 个断言。新增非文本测试后的 `tsc -b` 与受影响格式检查也单独通过。
