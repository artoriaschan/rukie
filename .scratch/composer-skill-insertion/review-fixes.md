# 独立评审修复记录

负责人：本次全新修复代理；工作树 `/tmp/rukie-composer-review-fix`，分支 `fix/composer-review-findings`，起点为集成 `630e7733`。所有工单继续 claimed，由主代理维护统一验证记录与交付状态。测试缝沿用 spec 已确认的 wire → 实际 Session、公开历史消息与 Chromium DOM/提交内容，不断言编辑器私有状态。

## 修复与影响

- P1 技能目录：`skills.list` 与 Session 都使用原样的 `options.dataRoot`，不再从独立 `configurationRoot` 扫描内容。没有新增 root 选项、fallback 或迁移；Core 的 `dataRoot` 缺省时终端 namespace 语义不变。server README 明确配置库与技能来源的归属。公开 wire 测试创建独立数据根、配置根、终端 `.agents` 与 Project 同名覆盖，选择实际目录结果发送 slash，建立真实 Session Run，再用新连接读取历史消息中的 `skillInvocation`、文件路径与正文。
- P2 编辑：token 模块注册 RootNode transform，处理原生编辑、粘贴、换行与 undo 后的统一首节点／单 token 不变量。移动 token 时保留文字节点和范围选择；对 Lexical 把换行后的光标留在 token offset 0 的情况，恢复到其前置正文的同一位置。真实键盘覆盖 Home 输入、ArrowLeft、Shift+Enter、paste/undo 与继续输入后的精确提交值。
- P2 MCP fixture：两个新增 MCP 文件在首次 await 前注册专用 `ownMcpFixture`。参考既有 ownSessionFixture 与 ownResources 的幂等 Promise、pending acquisition 和超时后测试体抑制合同；不反向导入 server 私有测试 helper，也不搬动其所有消费者。MCP owner 额外负责先释放协议 barrier、给 Session 初始化和 prepareRun 提供取消 signal、等待迟到初始化并拥有其关闭，最后恢复时钟；finally 与 Bun onTestFinished 共用同一 Promise。保留所有 MCP 行为断言。新增真实子 Bun 超时回归以及迟到资源／二次关闭不能恢复下一 owner 时钟的公开 helper 合同回归。
- P2 样式：共享插入列表行从 6px 改为 DESIGN.md 的 MD/8px，既有 32px 行高与 shell 几何不变。现有 MCP 摘要与详情交互用例同时检查 Light/Dark 的圆角、行高及 selectable/disabled cursor，原页面布局断言保留。
- 全套发现的 startup 回归：正常关闭发生在异步全局配置发现完成前时，warmup catch 不再报告已关闭 Host 为启动错误；仍等待 ready。新增公开 Host close/ready/warning 回归，原 TUI 模型、locale 与缺失 Session 的 stderr 断言不改动。

## 红灯与中间失败

- `rtk proxy bun test packages/server/tests/server.test.ts -t 'split-root skill catalog'`：原实现 0 pass / 1 fail，261ms（case 28.52ms），实际配置根 `configuration-only`，预期数据根 `review`。日志 `/tmp/rukie-review-server-red.log`。
- server 测试完善期间发现 fixture 读取了 session.create 初始空 snapshot；改为新连接读取历史。随后发现 wire user content 是 text block 数组、每个新 UI 连接替换旧连接；断言与 client 使用按真实 wire 合同修正，保留实际 Skill Invocation 断言，未改产品规避测试。中间 2-case 运行分别 1 pass / 1 fail（373ms、3.38s、321ms、319ms、3.33s），最终结果见下。
- `rtk proxy bunx --no vitest run --project ui-browser tests/components/skill-insertion.browser.test.tsx -t 'editing before a skill'`：原实现 1 fail / 7 skip，889ms（case 145ms），首 DOM 节点为 prefix 文本而非 token。日志 `/tmp/rukie-review-editor-red.log`。
- 首次 Root transform 对 Home 原生输入通过，但 Shift+Enter 后 Lexical 保留 token offset 0，后续文字落错位置；组合运行 11 pass / 1 fail，16.46s，随后单例 1 fail，1.90s。通过恢复同一逻辑 caret 修复；实际 DOM `innerText` 检查换行，未用 textContent 假定 `<br>` 自带换行字符。该失败是选择恢复缺陷，非放宽断言。路径错误导致两次辅助 Python 编辑未执行，不构成产品 red；修正 cwd 后使用原定最小命令。
- `rtk proxy bunx --no vitest run --project ui-browser tests/components/mcp-insertion.browser.test.tsx -t 'MCP summary enters'`：原 CSS 1 fail / 4 skip，825ms（case 118ms），computed radius 为 6px，要求 8px。日志 `/tmp/rukie-review-radius-red.log`。
- Standards 的 fixture 原始缺陷由评审确认：资源／全局 fake timers 仅 finally 释放，没有 runner timeout hook。新回归用实际子 runner 的 50ms body deadline，setup 在 beforeEach 完成后才开始计时；不把初始化速度计入 timeout。
- `rtk proxy bun test packages/agent/tests/e2e/mcp-host.test.ts -t 'closing during global warmup'`：原实现 1 fail / 9 filtered，120ms（case 2.50ms），收到 `MCP startup: MCP Host has been closed.`。日志 `/tmp/rukie-review-warmup-red.log`。主代理原完整检查日志保持原失败结果，此修复未运行完整 check。

## 当前有效 focused 证据

所有 Bun 命令 cwd 为本修复工作树根，Bun 1.4.2；Vitest 命令 cwd 为 `packages/ui`，Node Vitest 5.0.3 / Chromium。home、项目和凭据使用原有隔离 fixture；没有启动 Electron、访问真实用户 Session 或凭据。

| 命令                                                                                                                                                                                                                                        | 结果与范围                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `rtk proxy bun test packages/server/tests/server.test.ts -t 'skills.list\|split-root skill catalog'`                                                                                                                                        | 2 pass / 0 fail / 94 filtered，366ms；新实际 Run case 100.11ms。`/tmp/rukie-review-server-green.log`                  |
| `rtk proxy bunx --no vitest run --project ui-browser tests/components/skill-insertion.browser.test.tsx -t 'editing before a skill\|linebreak, paste'`                                                                                       | 2 pass / 7 skip，905ms；包括精确继续输入位置与发送内容。`/tmp/rukie-review-editor-invariant.log`                      |
| `rtk proxy bunx --no vitest run --project ui-browser tests/components/skill-insertion.browser.test.tsx tests/components/skill-clipboard.browser.test.tsx tests/components/mcp-insertion.browser.test.tsx tests/app/layout.browser.test.tsx` | 23 pass / 4 files，3.41s；包括原 clipboard／history 操作、两种行状态和布局几何。`/tmp/rukie-review-browser-green.log` |
| `rtk proxy bun test packages/agent/tests/e2e/mcp-fixture-lifecycle.test.ts packages/agent/tests/e2e/mcp-host.test.ts packages/agent/tests/e2e/mcp-health.test.ts`                                                                           | 23 pass / 0 fail，1.256s；case 最大 209.45ms。`/tmp/rukie-review-mcp-green.log`                                       |
| `rtk proxy bun test packages/agent/tests/e2e/mcp-host.test.ts packages/agent/tests/e2e/mcp-health.test.ts`                                                                                                                                  | prepareRun 取消 guard 的最后差异：22 pass / 0 fail，见 `/tmp/rukie-review-mcp-guard.log`；其余 MCP 证据有效           |
| `rtk proxy env -u NO_COLOR bun test packages/coding-agent/tests/tui/main.test.ts packages/coding-agent/tests/tui/e2e/errors.test.ts -t 'startup error\|startup translates\|unknown\|--model'`                                               | 12 pass / 0 fail / 59 filtered，613ms；保留原始 stderr 断言。`/tmp/rukie-review-startup-green.log`                    |

后续只修改 helper 回归与强制 Light/Dark 类名的测试，按最小失效范围增量检查，不重跑四文件浏览器集合或所有 MCP 行为。最终增量结果和静态证据补于下段。主代理先前 check:dev 和完整检查已通过的 Core 阶段可复用，本记录不把完整检查失败改称通过；主代理拥有剩余全套失败调查、手工 Chromium 增量验收和最终交付。

## 最终增量与静态检查

- 移除仅供旧 finally 清理使用的多余 Session 数组并保留 owner，新增迟到 acquisition／下一 owner 时钟回归后：`rtk proxy bun test packages/agent/tests/e2e/mcp-fixture-lifecycle.test.ts packages/agent/tests/e2e/mcp-host.test.ts -t 'cleanup owns|runner timeout|replacement signature|global stdio'`，4 pass / 0 fail / 8 filtered，522ms；日志 `/tmp/rukie-review-mcp-final.log`。最大 case 202.69ms，为真实子 runner 启停与网络初始化的必要成本，未新增固定等待。
- 显式设置 `.light` / `.dark` 后，仅复验所改样式消费者：`rtk proxy bunx --no vitest run --project ui-browser tests/components/mcp-insertion.browser.test.tsx -t 'MCP summary enters'`，1 pass / 4 skip，839ms；日志 `/tmp/rukie-review-radius-final.log`。上述23-case页面布局／editor证据继续有效。
- `rtk proxy bunx --no tsc -b packages/agent packages/server packages/ui`、修改 TypeScript 文件的 focused oxlint 均 exit 0。测试 helper／测试 refinements 之后增量 `tsc -b packages/agent packages/ui` 与所改三文件 focused oxlint 也 exit 0；日志 `/tmp/rukie-review-types-final.log`、`/tmp/rukie-review-lint-final.log`。
- `rtk proxy bun run check:test-policy` exit 0，482 个 test/fixture；`rtk proxy bun run docs:update`、`rtk proxy bun run check:docs` exit 0，157 Markdown。变更文件使用 oxfmt，`rtk git diff --check` exit 0。没有运行 check:dev、完整 check 或手工浏览器；这些由主代理拥有，已有未失效证据复用。
- 最后将 MCP 测试动态 import 提到文件静态 import，保证每例 owner 都在第一次 await 前注册；子 runner 释放同时等待输出 reader 完成。只补这一 cleanup 用例与修改文件静态检查，未重跑其余已通过集合。
