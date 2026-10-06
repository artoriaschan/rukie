# 07: TUI 授权面板与 notice

**What to build:** TUI 用户在 server 需要授权时收到一次提示；模型调用 `authenticate` 时，输入框位置出现照 dsh OAuth 登录复刻的授权面板，可以自动或手动打开浏览器、复制链接、粘贴回调 URL；授权结果用 notice 反馈。详见 [MCP OAuth spec](../spec.md) 的 TUI 一节。

**Blocked by:** 03

**Status:** resolved

- [x] host 新增 `writeClipboard(text): Promise<boolean>`（依次尝试 pbcopy、wl-copy、xclip、xsel、clip.exe）；`openExternal` 接受 URL，文件路径保持现有行为；测试 helper 提供默认 stub
- [x] `onMcpAuth` 复用 question 面板，和审批、提问共用同一个槽位与 FIFO 队列；布局为 `◈ <server>`、问题、detail（动作结果、引导语、完整 URL）、复制授权链接 / 重新打开浏览器 / 取消登录、粘贴回调 URL 的自定义回答栏
- [x] 打开面板时调用 `openExternal(url)`，按成功或失败选择引导语；复制和重新打开的结果插到 detail 第一行（文案照 dsh 原文）；取消或 Esc 返回 `cancelled`；`signal` abort 时关闭面板；没有 spinner
- [x] notice：成功 `已登录 MCP 服务器 {{name}}`（success，4 s），失败 `OAuth 登录失败 · {{err}}`（error，8 s），取消 `已取消 MCP 授权`（dim）；收到 `mcp_auth_required` 时每个 session 每个 server 只显示一次 warning `MCP 服务器 {{name}} 需要授权 · /mcp login {{name}}`
- [x] zh / en 文案同步
- [x] TUI e2e：模型调用 authenticate 后出现面板，`openExternal` 收到 URL；复制和重新打开的行为；打开失败时的引导语；本地回调到达后自动关闭并出现成功 notice；粘贴路径；取消；和审批面板排队；needs-auth notice 只出现一次；40×12 下 URL 能换行
- [x] 默认的 `writeClipboard` / `openExternal(URL)` 在 macOS 上手动验证并记录

## 实施与验证记录

- 授权请求进入现有 question Interaction FIFO，只有可见队头启动浏览器；复制与重开保留面板，异步结果只更新仍然有效的请求。回调粘贴、Esc、取消、本地回调、Run abort 复用 Agent Core 的结果与 signal。
- QuestionDialog 保留普通提问路径，授权 detail 以 ScrollBox 显示完整 URL；40×12 中可用 PageUp / PageDown 查看 URL，尺寸恢复后仍可操作。MCP 通知由 conversation 管理并在 stop 时清除计时器；已有图片通知优先级和颜色保留。
- 新增公开 `start` + headless terminal e2e，运行 Agent Core 已有的真实 fake OAuth/MCP fixture。fixture 通过动态 URL 导入其所属测试项目的 runtime API，避免跨 TS project root 静态导入生成声明文件；不复制或替代 pi OAuth 实现。
- TDD：首先复现模型 authenticate 未提供 callback 时没有面板；接通 Interaction 后复现结果 notice 缺失；40×12 URL 滚动复现 PageDown 被 Transcript 截获；分别在所属层修复并转绿。复制、重开、手动打开、粘贴、本地回调、取消、state 错误、FIFO、late host result、zh/en resize 和 4 s / 8 s 生命周期均由终端画面及 host 调用验证。
- focused：隔离临时 HOME、unset NO_COLOR，`bun test apps/neant-tui/tests/e2e/mcp-auth.test.ts apps/neant-tui/tests/e2e/questions.test.ts apps/neant-tui/tests/e2e/question-panel-parity.test.ts apps/neant-tui/tests/e2e/permissions.test.ts apps/neant-tui/tests/screens/chat/interactions.test.ts`：105 pass / 0 fail，550 assertions。初次未清除外部 NO_COLOR 的 focused run 有三项旧颜色断言失败；规范环境重跑全绿，不改变实现。重开反馈精确断言加强后 OAuth 单文件 12 pass / 0 fail，31 assertions。
- 首次 isolated full `env -u NO_COLOR bun run check`：format、lint、types、Knip 通过；2252 pass / 1 fail，唯一失败是原有 `long question copy and many todos fit a 20-row dock at three widths` 5 s timeout。独立 10 次新进程复跑全部四种 dock 高度：40 pass / 0 fail，未采用源码或测试 workaround。完整检查按相同隔离要求重跑：exit 0，2253 pass / 0 fail，11575 assertions（312.24 s）；format、lint、types、Knip 全部通过。
- macOS 默认 host 手动验收由 root 执行：`writeClipboard(marker)` 返回 true，`readClipboard()` 读回精确文本；默认 `openExternal(http://127.0.0.1:<port>/mcp-oauth-host-smoke)` exit 0，系统浏览器 GET 到达 Bun server。保存并恢复原 NSPasteboard 多格式内容，changeCount guard 避免覆盖更新的用户复制。验收脚本 exit 0；未验证真实托管账户，后续命令与 live-account 验收属于 08。
- Standards / Spec 自审：包依赖方向、两种 locale、普通问题与图片生命周期保持现有契约；Agent Core 拥有 OAuth，Frontend 只呈现 Interaction 和结果；TUI README 已同步。
- 集成前已合并最新 `codex/mcp-oauth`：先 04 的 `7a65a12`，再 05 的 `4569871`；均无冲突，无需改动 07 实现。04 合并后 TUI 五组、Core MCP/config/OAuth/lifecycle、CLI main 共 219 pass / 0 fail（1023 assertions）；05 合并后 TUI 五组、Core OAuth/subagent OAuth 共 129 pass / 0 fail（650 assertions）。每次合并后 format、lint、types、Knip 全通过；剩余全量组合检查由 root 执行。

## Comments

2026-10-06 review fixes: OAuth typing/paste focuses the callback input; explicit Copy/Reopen/Cancel selection wins over a retained draft. Public terminal regressions exercise all three actions with a valid callback; the existing paste-and-Enter path and ordinary Question parity pass unchanged. Known OAuth and MCP failures use formatError in zh/en notices while English model results remain intact. The old Chinese configuration-prefix expectation was updated without changing notice color, one-line, once-only or hidden-reminder assertions.

Final focused MCP/API/lifecycle/TUI/question verification: 198 pass / 0 fail (861 assertions); existing tools-and-notices file: 14 pass / 0 fail (72 assertions). Fresh isolated HOME, env -u NO_COLOR caffeinate -is bun run check: exit 0, 2309 pass / 0 fail, 11818 assertions across 166 files (308.73s), format/lint/types/Knip passed. Final log: /tmp/neant-mcp-oauth-review-check.log. Initial full had only the obsolete Chinese expected-English prefix failure (2308/1); preserved /tmp/neant-mcp-oauth-review-check-before-localized-expectation.log. Both review axes confirm all findings resolved.
