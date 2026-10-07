# 06: 其余内置工具与 MCP 的 view

**What to build:** read、grep、glob、web_fetch、MCP、goal、job 工具都有各自的卡片样式，不再只是原始文本。见 [spec](../spec.md) 的「Presenter」与「TUI 工具卡」。

Blocked by: 01

Status: resolved

- [x] read 出 read view，标题为路径，正文为文本内容
- [x] grep 出 search `matches` 形态（按文件分组 + `n: line`），glob 出 `paths` 形态；截断时显示总数
- [x] web_fetch 出 web view，标题为 URL，正文以 Markdown 渲染并受折叠规则约束
- [x] MCP 工具出 generic view，`kind: other`，标题由 frontend 拼成 `server › tool`
- [x] goal 工具出 generic 摘要卡；job 工具有 view；后台 bash 为 generic 卡 + JobCard 行，JobGroupHeader 保留
- [x] 现有 TUI 中按工具名零散拼摘要的特例（web_fetch 首行等）删除，统一走 view
- [x] Agent Core e2e 断言各工具 view；TUI e2e 覆盖各卡片渲染

## Implementation evidence

- Owned presenters supply read/search/web/generic views from args and persisted facts. Search details retain totals and complete entries; ripgrep JSON keeps paths containing colons unambiguous. Web stores its bounded Markdown body in details without changing model text. MCP has separate server/tool facts; offline resume falls back to undefined views. Goal bodies expose the objective rather than the controller JSON. Job controls and background bash retain generic cards.
- ToolCall now gives result views precedence over raw conversation strings, groups search matches by file with line numbers, exposes truncated totals, renders bounded web Markdown, and composes MCP identity.
- Public seams: createSession + fake model (read/search live and resume, web Markdown, goal/job summaries, MCP offline resume, truncation, colon paths, background bash/output/kill); start + headless terminal (all card families and localized display names). Existing web tests updated from legacy first-line behavior to spec URL/Markdown behavior at 120/60 columns.
- Focused validation before integration: 97 tests across remaining/web/HTML/goal agent and TUI files passed in 2.68s; new additional Session coverage passed in 350ms; 2 new TUI scenarios passed in 561ms. No new test exceeds one second. check:dev passed.
- Remaining heuristic-removal checkbox is coordinated with ticket03, which owns conversation routing. Pointer: screens/chat/conversation.ts toolSummary web_fetch special-case, toolEntry goalSummary/name suppression and web_fetch first-line result. Card rendering already uses resultView over those obsolete strings.

- Integration sync: merged integration `2af2dc9` (tickets02/04), preserved unified diff tones/eight-line folding and all single/global expansion behavior. Reinstalled locked dependencies for the newly integrated TUI diff dependency. Post-merge: 9 new public Session/TUI tests passed (733ms); 25 related diff/expansion/background-job/web tests passed (8.67s), plus check:dev. Two unchanged background-job lifecycle tests take 2.12s/3.27s due their existing real process cancellation contracts; no new or modified06 scenario exceeds one second. Root runs the final aggregate gate after all tickets integrate.

- Ticket03 integration completed the deferred conversation heuristic removal: tool summaries no longer special-case web_fetch; goal/todo name suppression and frontend JSON parsers are gone; raw result text remains available while resultView owns presentation. Goal-tool-card live/resume and remaining-view tests validate the presenter result. Ticket06 is resolved after that coordinated change.

### Review 修复验证（2026-10-07）

- read 的截断/继续读取 offset 从 pi 的实际 details 验证推导，不解析正文猜测、不重新读取文件；bash 完整输出路径从持久化 details 重算。提示不受折叠/400 行窗口影响。public live/resume 和 notice-like 正文回归通过。
- `bun run check:dev` 通过；最终 aggregate 在 integration branch 统一执行，结果由 spec 验证记录补充。
