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

## 最终交付验收 — 2026-10-16

最终生产源码为 `9d1347b4`，分片路径元数据修正为 `3d2dcfd0`。其后只关闭 tracker、归档证据，不改变行为。PR 为 [#42](https://github.com/artoriaschan/rukie/pull/42)，目标 main；resolved 表示本地交付完成，最新 commit 的 CI 以 PR checks 为准，尚未授权合并。

### 独立评审与 ADR Coverage

新 Standards 与 Spec 评审代理分别检查 `71802c6e...630e7733`，原始报告分别保留在 [Standards](evidence/standards-review.md) 与 [Spec](evidence/spec-review.md)。Standards 的 timeout-safe fixture ownership、菜单行圆角两项 P2；Spec 的有效技能根 P1、首节点 token 不变量 P2。四项集中交给一个全新实施代理修复，随后由另一个全新合并代理审阅完整 diff 并确认关闭；没有复用已结束的代理。修复红绿与精确影响范围见 [review-fixes](review-fixes.md)。没有未解决的评审发现。

最后重新核对 spec ADR Coverage 与修复 diff：技能 catalog 使用执行所属的 dataRoot、token 首节点约束兑现 ADR-0048 既有合同；fixture owner 兑现测试策略与 ADR-0004，没有新增架构决定；8px 行圆角恢复 DESIGN.md；关闭时的 warmup 告警修复兑现 ADR-0047 的资源释放。计时文件 rename 属机械元数据修复，无需 ADR。覆盖表无遗漏或冲突，ADR-0047/0048 accepted，无交付依赖的 proposed 决定。

### 完整检查的实际结果与增量复验

主代理因 MCP Host 跨 Session、Run、子代理和 Frontend 的共享生命周期风险，在隔离 HOME 下执行一次 `rtk proxy env -u NO_COLOR HOME=<run>/home bun run check`。原始结果 **exit 1**，不将后续 focused 通过改写为全套通过。原日志目录为 `/var/folders/ql/gqv08x1d593_4fssr6n92gq80000gn/T/rukie-composer-final-jbw9awqo`（下称 `<run>`）。

- `check:dev` 完整通过：format、lint、tsc、Knip、tracker、docs、ink boundaries、test policy 和 UI typography。
- modules/scripts：558 pass、0 fail，47 文件，7.56s。
- Agent Core：1538 pass、0 fail，113 文件，139.51s。
- coding-agent：1528 pass、21 fail、4 errors，182 文件，293.51s；release 与 desktop 尚未执行。

21 个失败按共同原因分组，保留原日志，修复和复验如下。

1. 7 个原 stderr 精确断言被正常关闭时的 `MCP startup: MCP Host has been closed.` 污染。`9d1347b4` 修复后台 warmup／close 竞态；原 startup 集合 12 pass、0 fail、59 filtered，613ms，断言未放宽。公开 Host close/ready/warning 红绿与 MCP fixture 超时、迟到资源和时钟恢复证据见修复记录。
2. 14 个既有真实子进程启动超时（lifecycle 4、颜色 8、resize 2），4 errors 随超时出现。新诊断代理确认外部临时 JSX 文件自动导入 bare `react/jsx-dev-runtime` 时触发 Bun 依赖解析；这些测试及 renderer 自基线无改动。只为复验进程设置 `NODE_PATH=<repo>/packages/coding-agent/node_modules` 与显式真实 Bun cache，保留隔离 HOME、原测试和时限：14 pass、0 fail、21 filtered，249 assertions，1.489s（case 约 95–112ms）。[因果诊断](evidence/rukie-composer-child-timeout-diagnosis.md)记录 cold 3008ms timeout、`--no-install` 缺依赖与本地解析 26.1ms 探针。没有提交 classic JSX pragma、放大 timeout 或改变生产实现。

修复使 helper／导出图失效的静态范围由修复代理重验：affected tsc/lint、482 个 test/fixture policy 与 docs 通过；主代理对最终图执行 `rtk proxy bunx --no knip`，exit 0。原 check:dev 其他有效证据复用。

### 补齐尚未执行的 release 与 desktop

没有重复已通过的 Core、module 或完整 suite。仅执行原失败阻断的剩余阶段，所有命令继续使用隔离 HOME 与明确 NODE_PATH。

- `rtk proxy env -u NO_COLOR HOME=<run>/home NODE_PATH=<repo>/packages/coding-agent/node_modules bun --no-orphans scripts/release/build.ts --out <run>/release`：exit 0，生成本次源码实际 release archives。
- 同环境加 `RUKIE_RELEASE_ARTIFACTS=<run>/release`，执行 `bun test --parallel=1 scripts/release/tests`：实际 112 pass、1 fail，113 tests／12 文件，1107 assertions，166.09s。唯一失败为 ticket 06 的 manager→host 测试 rename 未同步 timing map。全新实施及合并代理只修正路径并保留 83 的历史 seed；原 case 红 0 pass／1 fail，绿 1 pass／0 fail，8ms、1595 assertions。见 [计时路径修复](shard-timing-fix.md)。其他 112 项证据未失效，不重跑 release。
- `rtk proxy env -u NO_COLOR HOME=<run>/home NODE_PATH=<repo>/packages/coding-agent/node_modules bun run test:desktop`：19 Node 文件、81 tests 通过；browser startup 因隔离 HOME 查找不存在的 Playwright cache 产生 1 unhandled error。不是 browser 用例通过。
- 首次根目录 `--project ui-browser` 无 project，0 tests。纠正为 `packages/ui` cwd，设置 `PLAYWRIGHT_BROWSERS_PATH=/Users/artorias_chan/Library/Caches/ms-playwright`，同隔离环境执行 `rtk proxy bunx --no vitest run --project ui-browser`：**52 文件、343 tests 通过，22.82s**。只补未执行的 browser project，不重跑 81 个 Node tests。适用 desktop 覆盖合计 71 文件／424 tests；原两次启动失败保留，未声称单次 test:desktop 完整绿灯。

### Chromium 手工验收与限制

使用 `agent-browser` CLI 和 `bun run dev:desktop:web --isolated`；仅临时配置、内存加密、loopback fake provider、虚构技能与 MCP stdio fixtures。最终源码 `9d1347b4`，Light／Dark 1280×900、窄宽 420×800；没有启动 Electron 或读取真实凭据／Session。

- plus 三组、slash 名称过滤、大小写与多于 10 项的键盘循环／高亮滚动；焦点保持 combobox，nested label/icon 的 pointer 与 readonly MCP 的 not-allowed 均确认。MCP 详情 Enter 不发送、按名过滤、Esc 逐级返回与关闭清空。
- 主 form 与列表宽度 752px、上方间隔 4px、既有 form 高 100px；窄宽 panel 340px，无水平溢出；Light/Dark 行圆角均 8px。原 shell/layout 自动断言保留。
- 实际 global 技能从有效 dataRoot 发现，选择、发送后持久化历史确有 skillInvocation；同名 project 只显示生效版本。Home 输入、Shift+Enter、undo/redo 后 token 仍首部并保留正文。
- 用公开 ClipboardEvent/DataTransfer 检查 plain Markdown、HTML 字面文本、内部节点格式和首部 paste 还原；自动化 Chromium 覆盖复制／剪切／粘贴／undo 的完整路径。headless Chrome 的 OS Clipboard API read 权限被拒，未把原生系统剪贴板读取记为通过。
- 历史标记依据持久化事实：仅删除本次 fake SKILL.md 并刷新 catalog 后仍显示标记，copy 从路径链接回退 `/acceptance-review`。修复前观察到的失败与最终截图分开保留，不以旧截图证明最终状态。
- MCP 手工检查 healthy（1 tool）与失败 server 的实时摘要、详情、过滤、readonly 和键盘；pending/auth/config error 等完整矩阵由自动化用例覆盖，不声称全部手工复现。
- 最终 177 个 network requests，无 HTTP ≥400 或 transport error；browser errors 为 []，console 只有 Vite debug 与 React DevTools info。汇总见 [browser evidence](evidence/browser-summary.json)。

截图：[Light 插入列表](evidence/final-light-plus.png)、[Dark MCP](evidence/final-dark-mcp.png)、[窄宽 MCP](evidence/final-narrow-mcp.png)、[Light 历史](evidence/final-light-history.png)、[Dark 历史](evidence/final-dark-history.png)。截图均已查看。原始网络、控制台和全部 command logs 留在 `<run>`；repo 只归档必要结论与交付截图。

### 清理与收尾

最终 browser session 已关闭，自己启动的 launcher 已退出；临时根 `rukie-web-isolated-SLcCGm` 已删除、PID 41863 不存在、sidecar 53016 不监听；前一次隔离 launcher 也已退出并删除其临时根。早先 IPv4/IPv6 同端口的无关服务没有被终止。

工单 01–09 与 spec 在同一交付变更置为 resolved。后续仅文档／证据修改，复用上述行为、静态和浏览器结果，运行 docs/update、docs、scratch、改动 Markdown 格式与 diff 检查。没有为了合并代理交接或文档提交重复执行测试。CI 待最新推送后核实，不将本地结果当作远端 acceptance，也不合并 PR。

- 11 个实施／修复 worktree 已逐个核实 clean、HEAD 为集成分支祖先，且没有进程以其目录为 cwd；ignored 内容仅 Husky 生成 hook、node_modules 和 Vitest cache，没有用户数据。随后用非 force 的 `git worktree remove` 与 `git branch -d` 清理全部 11 个工作树及分支。[删除前审计](evidence/cleanup-audit.json)与[实际删除结果](evidence/cleanup-results.json)已归档；当前集成 worktree 和所有无关工作树保留。

- 收尾文档实际检查：`rtk proxy bun run docs:update`、`rtk proxy bun run check:docs`（157 Markdown）、`rtk proxy bun run check:scratch`、`rtk proxy bunx --no oxfmt --check .scratch/composer-skill-insertion`（19 files）与 `rtk git diff --check` 均 exit 0。只改文档、状态与证据，未重跑行为验收。

- 推送前核对旧 PR commit `122a9b16` 的 CI run `38874175161`：shard 2 的 6 个 startup、shard 3 的 1 个 model override 与 shard 4 的 1 个 timing-map 失败，逐项对应本次已修复且本地最小复验通过的两类原因。旧 run 仍为失败，不代表最终推送结果；没有发现需要额外扩大修复范围的旧 CI 失败。
