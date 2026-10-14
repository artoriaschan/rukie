# 06：整体验收

Status: resolved

Blocked by: 01, 02, 03, 04, 05

**What to build:** 对整份 [spec](../spec.md) 做交付验收。复用各工单已有的验证证据，只补充被后续改动失效的部分。

- [x] 对照 spec 的 User Stories 与 Implementation Decisions 检查实现，并完成 [ADR Coverage](../spec.md#adr-coverage) 审阅：ADR-0041 更新从 proposed 转为确认，链接与状态正确
- [x] DESIGN.md、CONTEXT.md、ADR、README 与实现一致；zh 与 en 文案完整
- [x] `bun run check:dev` 通过；受影响的 server、ui-node、ui-browser 测试有通过证据
- [x] 以 `bun run dev:desktop:web --isolated` 做一次 agent-browser GUI 验收：外壳三栏与阴影、创建、信任、编辑、移除、详情卡、项目行；覆盖 Light、Dark、窄宽度、光标、hover、焦点、控制台与网络。完成后关闭浏览器会话并停止启动器
- [x] 记录验证结果与剩余限制，所有工单与 spec 状态更新为 resolved

## Comments

- 2026-10-14：新的 06 实现代理在独立工作树 shell-palette-06/rukie、分支 test/project-management-acceptance 认领；基于已集成复审修复 821c1038，复用验证记录中的有效 focused 证据。当前只补充首次 check:dev、适用 desktop 包级和一次隔离 Chromium GUI 验收。

- 2026-10-14：整体验收完成，50 项故事逐项对应当前源码、已有 focused 证据与本票手工 GUI；ADR0041/0031 accepted，spec 覆盖表已确认并补充历史 cwd 别名执行信任归属。静态采用首次 check:dev 的通过前置阶段与最小 unused export 修正后的 Knip/下游/受影响 scoped 结果组合，不把首次失败改写为通过。desktop 首次整包实际 236 pass / 2 fail、43.93s；两项失败最小复现后修正并 2 pass / 26 skip、3.32s，未整包重试。C27 被动点击后 Esc 新缺陷先 red，再由 ProjectDialog 的非 Tab 序焦点承载修复；C28/C29/C31 取消返回、pending 与几何相关 8 pass / 20 skip、13.57s。C30 英文改为 Sessions: count，两消费者 2 pass / 21 skip、3.63s。真实 legacy alias hook 回归先失败，再以相同目录身份的 trusted owning Project 派生 cwd spelling 修复；相关 3 pass / 55 filtered、51 assertions、2.21s，单例均低于 1s。
- GUI：一次最终隔离 Chromium 验收覆盖 Home/Session/Settings、C27–C31、Light/Dark/420px、hover/焦点/光标、主目录继任与最后目录保护、信任取消/新增标记、真实 create/update/remove 与当前 Session/Transcript/置顶保留、详情卡 4px 通道/固定/键盘/夹取、长路径及 console/network。后续可见差异只复查 Esc 区域和英文 C30；其他证据复用。有效截图目录为 `/Users/chenzheng/.codex/visualizations/2026/10/14/01a138a9-fed3-7e92-bc38-1b2e53ed718c/shell-palette-project-management`。所有命令、源状态、失败截图与故事/ADR 审阅见 `/tmp/rukie-shell-palette-evidence/ticket06.md`、`story-audit06.md`。
- 边界：picker 仅在临时未提交 HTML 中替代为 unsupported 错误及隔离真实目录队列，App/WS/server 保持真实；macOS ordinary Web 本来支持原生 picker，初始计划假设被源码推翻，一次 picker 命令已取消且未选择目录。初始 localhost IPv6 页不是本票源码，已排除并用本票 IPv4 resolver 保持同 Origin 验收。没有 Electron/钥匙串/真实配置或 Session 验收。工具 about:blank 恢复事件不视为 App 缺陷；实际路径选择正常，剪贴板读取权限不足所以不声称复制验证。console 无错误，网络仅临时 HTML 缺省 favicon 的 404，生产页面有内联 favicon。浏览器均关闭，两次启动器退出 0 并删除隔离目录，临时 HTML 已删除，其他已有 Vite 未更改。
- 全部工单与 spec 在本次本地验收变更中关闭；resolved 不代表 CI 已通过、PR 已 ready 或已合并。PR #24 的旧远端绿色提交不是本次验收证据，最终提交/CI 与合并授权由主流程负责。
