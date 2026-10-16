# 验证记录

验证负责人：主代理。基线：`71802c6e`，集成分支：`feat/composer-skill-insertion`。

## 范围与约定

- 测试缝沿用 spec 的 Testing Decisions：公开 Session/MCP Host、wire、Chromium 组件与历史消息 DOM。该规格已明确这些缝，实施不重复请求确认。
- 每票使用新的实施代理与独立 worktree；每次集成使用新的合并代理。
- 实施代理先记录红灯，再记录必要 focused 检查及耗时；不独立启动全套检查或手工浏览器验收。
- 静态检查、最终全套检查与手工 Chromium 验收由主代理统一协调；快进、评审、提交与文档修改不使行为证据自动失效。
- MCP Host 改变跨 Session、Run、子代理和 Frontend 的共享生命周期，最终按 spec 运行一次完整 `check`。

## 初始环境

工作区干净。SSH fetch 失败（连接关闭）；HTTPS fetch 失败（SSL_ERROR_SYSCALL）。当前 HEAD 仅比本地 origin/main 多本任务规格提交；继续同一任务基线，发布前重新核实远端。

## 证据

### Ticket 01 — Lexical composer

State: `feat/composer-ticket-01`, based on integration, editor source/tests/dependency lock and tech-stack changes. Runner: Node Vitest 5.0.3 / Chromium, cwd `packages/ui` in isolated `/tmp/rukie-composer-01`. Existing fixture configuration remains isolated; no native Electron or real credentials.

- Initial root `bunx --no vitest run --project ui-browser ...`: startup failure, root filter matched no project, 0 tests. All commands below use `packages/ui`.
- Baseline `bunx --no vitest run --project ui-browser tests/components/composer.browser.test.tsx tests/components/compact-composer.browser.test.tsx tests/components/input-focus.browser.test.tsx tests/app/layout.browser.test.tsx`: 22 passed, 3.80s. Geometry covers title/sidebar/Transcript/dock, wide/narrow and font scaling.
- New compact case, `-t 'plain-text composer'`, before migration: 1 expected red, 2 skipped, 15.56s; old textarea lacks contenteditable. Same case after migration: 1 passed, 2 skipped, 744ms; covers IME, Shift+Enter, multiline paste, send, clear and focus.
- Same four baseline files after migration: 23 passed, 3.71s. Original exact geometry assertions retained; placeholder targets rendered pseudo-element.
- Consumer command `bunx --no vitest run --project ui-browser tests/app/goal-mode.browser.test.tsx tests/app/plan-mode.browser.test.tsx tests/app/plan-pane.browser.test.tsx tests/app/plan-review.browser.test.tsx tests/app/questions.browser.test.tsx tests/app/shell.browser.test.tsx tests/app/transcript.browser.test.tsx tests/app/model-services.browser.test.tsx tests/components/semantic-roles.browser.test.tsx`: 122 passed, 2 failed, 24.96s. Two failures isolated below; other consumer evidence remains valid.
- `bunx --no vitest run --project ui-browser tests/app/shell.browser.test.tsx tests/app/goal-mode.browser.test.tsx -t 'composer selects reasoning|Running and unfinished Goal'`: 2 passed, 38 skipped, 1.76s. IME native Enter linebreak fixed; placeholder checks move to aria-placeholder.
- `bunx --no vitest run --project ui-browser tests/components/compact-composer.browser.test.tsx tests/components/composer.browser.test.tsx tests/app/shell.browser.test.tsx -t 'plain-text composer|composer, permission|paste and drop'`: 3 passed, 34 skipped, 1.38s. Covers capture handling, plain over rich clipboard, unchanged placeholder geometry and image paste/drop.
- `bunx --no vitest run --project ui-browser tests/components/compact-composer.browser.test.tsx -t 'disabled and submitting'`: 1 passed, 3 skipped, 764ms. Covers disabled editability/cursor, exact untrimmed draft and send guard.
- Root `bunx --no tsc -b packages/ui` and focused oxlint: exit 0. Earlier type failures corrected; parent consolidates final static evidence.

Intermediate startup failure: newly imported Lexical modules made Vite reload the collecting test; explicit optimizeDeps includes fix this. Intermediate clear assertion expected an onValueChange callback that the original uncontrolled component never promised; replacement reads exact public DOM text. All prior textarea value assertions now compare exact visible editable text, preserving line breaks and whitespace. No geometry difference authorized. Full/package checks and manual Chromium acceptance remain parent-owned. Later unrelated core changes do not invalidate these editor results.

### Integration and ticket 02

- 票 02 的实施提交 `1cb49e8b` 已快进到集成分支；公开 MCP Host、Session 生命周期与原有 TUI 消费者的 focused 结果记录在[票 02](issues/02-extract-mcp-host-prefactor.md)。干净快进没有使证据失效，未重跑行为测试；统一静态检查和最终共享生命周期完整检查仍待执行。
- 网络恢复：主代理通过 `HTTPS_PROXY=http://127.0.0.1:20800` 的 HTTPS fetch 核实 `origin/main` 为 `52b7bd62`；集成基线包含该提交。
- 集成记录文档验证：`rtk proxy bun run docs:update`、`rtk proxy bun run check:docs`（157 个 Markdown 文件）、两份修改文档的 `oxfmt --check` 与 `rtk git diff --check` 均退出 0。没有更改生产代码，沿用实施代理的行为测试结果。

### Tickets 03–08 — 集成证据索引

以下为实施记录的导航与当前有效结论，完整红灯、失败聚类、增量复验与耗时保留在各票，不将中间失败或被替代结果改写为通过。票 01/02 证据见上文；后续共享生命周期改动仅复验其实际失效范围。所有票仍为 claimed，等待独立评审和主代理统一验收。

| 票                                                 | 最终证据与入口                                                                                                                | 当前有效范围                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [03](issues/03-slash-skill-insertion.md)           | Core 31 pass；wire 技能单例 1 pass；Chromium 六文件 31 pass，search locator 受影响单例增量通过                                | 生效技能目录、scope/filePath、无 Session wire、斜杠插入、缓存/切项目、steer、原始 shell 几何                                 |
| [04](issues/04-skill-token-clipboard-history.md)   | Clipboard/history 3 pass；消费者 26 pass 后 exact-whitespace 单例通过；cut/undo 单例通过                                      | plain/HTML/内部格式、首部还原与非首部文本、范围复制、持久化调用事实、已删除技能回退                                          |
| [05](issues/05-plus-list-builtin-commands.md)      | 受影响三文件 16 pass；最终本地化列表名两例增量通过                                                                            | 共用 plus/slash 列表、附件、Goal/Plan 开关、焦点与可用性、token/clipboard 组合；保留既有 Goal/Plan 和布局证据                |
| [06](issues/06-scoped-shared-mcp-connections.md)   | Host/作用域等 focused 结果及 48 个 TUI 用例见票；最终配置严格性 2 pass；合并后 server 3 pass                                  | 全局/项目实例、签名、初始化并发、29999/30000ms、重租、active-call 退休、auth、启动仅解密全局 MCP、TUI clear/resume           |
| [07](issues/07-mcp-connection-health-tool-sync.md) | 10 个 Agent MCP 文件 150 pass 后 Host 最小 26 pass、Health/OAuth 33 pass、授权 3 例增量通过；TUI 78 pass 后唯一失效 case 通过 | pending、Run 等待与取消、5 次退避、健康 30s 重置、原 close Promise、工具列表整代更新与同名 schema/描述、根/子 Turn、既有 TUI |
| [08](issues/08-composer-mcp-status.md)             | Host 26 pass；wire/server 19 pass 与 Session-view 1 pass；client 8 pass；Chromium 24 pass 后 MCP 两文件 6 pass；TUI 2 pass    | inspect/observe/active lease、readonly 历史、状态事件、重连、释放、无项目 project-required、摘要/过滤/返回/指针关闭与窄宽度  |

各票记录的 focused tsc/lint/format 仅作其修改范围的静态证据；前期 manager 测试类型错误由票 06 接续修复，票 05/07/08 后续对应类型检查通过。主代理拥有最终 check:dev、共享生命周期完整 check、Light/Dark/窄宽度手工 Chromium 与新代理独立评审。尚未记录为通过的这些验收不得由局部结果推断；CI 以最新 PR commit 的实际 checks 为准。

### Ticket 09 — 文档与 ADR Coverage 审阅（待独立评审）

- 基线：集成 `49bc9dd1`，隔离 `/tmp/rukie-composer-09`、`docs/composer-ticket-09`。依据 spec、票 01–08 的完整实施记录、最终 diff 和现行源码核对维护文档；只改 Markdown，不改生产源码、测试、配置或 DESIGN.md。
- 修复 architecture 的 Run-owned MCP 旧句；CONTEXT 区分 Host 所有权与观察；ADR-0047 补清连续健康 30 秒才重置、原 close Promise、同名工具声明更新、project-required 与观察/活动租约。项目相关用户 server 的显式 cwd 从项目根解析，否则项目根，与票 06 原确认合同一致；修正 spec 表格简写，没有改变实现。
- docs/mcp.md 保留配置和 Frontend 合同的单一归属，补明展示 scope/configPath 与连接作用域的区别、无连接 readonly pending，以及已有 Session／Project／无项目新会话的订阅生命周期。Agent README 补 public skill 元数据与 Host 注入/关闭导航；UI README 补 literal HTML/纯文本复制并去掉过时 plus 附件菜单句。server README 与 ADR-0048 经源码审阅已匹配，不复制其 API 细节。
- ADR Coverage 结论已写入 [spec](spec.md#adr-coverage) Comments：覆盖模块所有权与依赖、信任/授权、凭据身份和启动解密、生命周期、协议、编辑器、剪贴板与持久化事实；沿用 ADR-0011/0024/0031/0046，新增 accepted ADR-0047/0048，无新增未归属决定。已有 ADR-0035 的部分替代指向有效。独立评审和统一验收仍待完成，未关闭任何工单或 spec。
- 已知待 Standards 复核：`.composer-insertion-option` 当前 6px 行圆角与 DESIGN.md 标准菜单行 MD 8px 是否冲突，由新评审／修复代理处理；此文档票不修改规范来消除实现差异。

- 本票实际验证：`rtk proxy bun install --frozen-lockfile` 成功（1.114s）；`rtk proxy bun run docs:update` 与 `rtk proxy bun run check:docs` 均退出 0（157 Markdown）；9 份改动 Markdown 的 `rtk proxy bunx --no oxfmt --check <files>` 通过（204ms）；`rtk git diff --check` 退出 0。没有运行 tests、check:dev、完整 check 或手工浏览器；文档专属结果不代表这些待主代理完成的检查通过。
