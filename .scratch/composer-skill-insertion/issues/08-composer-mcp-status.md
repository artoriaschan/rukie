# 08：输入框中的 `/mcp` 状态

Status: claimed
Blocked by: 05, 07

**What to build:** 按 [spec](../spec.md) 的「插入列表」「状态接口」两节，在内置命令中加入 `/mcp`：一级行显示 MCP 汇总，进入后列出每个 MCP Server 的来源、状态与工具数。新会话页在没有 Session 时也能看到实时状态。

- [x] wire 新增 MCP 状态查询命令（项目或会话标识）与状态变化事件，按项目视图返回；无项目时返回全局单例，并把引用项目目录的用户级 server 标为需要项目；只读查询不启动进程，进入 `/mcp` 或选中项目时租用视图并在离开后释放
- [x] `/mcp` 一级行描述「查看 MCP 服务状态」，右侧汇总「x个MCP已连接 · x个工具可用 · x个MCP连接中 · x个MCP需要授权 · x个MCP连接失败」，数量为 0 的分段隐藏；无 server 显示「未配置 MCP」，首次加载显示「加载中」；过长截断并悬停全文；实时更新
- [x] 回车、Tab 或点击进入二级列表，输入保留 `/mcp ` 并按服务名过滤；Esc 或删掉 `/mcp` 回上一级，再按 Esc 关闭并清空
- [x] 二级行左侧 MCP 图标与名称，右侧「来源 · 状态」，已连接时追加「 · N个工具」；连接失败悬停显示原因；配置错误单独一行；无 server 显示「未配置 MCP 服务」；引用项目目录且未选项目显示「全局 · 选择项目后启动」
- [x] 二级行为不可用选项，回车不发送 `/mcp`，不插入会话；读屏读出名称、来源、状态与工具数
- [x] 新会话页切换项目时刷新；会话内读取该 Session 的项目视图
- [x] server 测试覆盖命令校验、无项目与事件推送；浏览器测试覆盖汇总、各状态、过滤、进入退出与无障碍语义；zh 与 en 文案同步

## Comments

## 实施与验证（待评审）

- 2026-10-16：新实施代理 `/root/implement_08`，独立 worktree `/tmp/rukie-composer-08`、分支 `feat/composer-ticket-08`，基于集成 `122a9b16`。沿用规格 Testing Decisions 已批准的公开 Host / wire / Chromium DOM 测试缝，应用 TDD、beUI、rukie-doc；CodeGraph 明确报告本 worktree 未索引，随后使用源码读取。没有复用实施代理。
- Host `inspect` 只读现有连接事实并重读配置，`observe` 订阅同一张连接表，不取得连接租约；`acquire` 取得活动视图，`noProject` 跳过依赖项目的用户条目。新增 `project-required` 表示无项目时的配置等待状态，不进入连接重试，工具数组为空、工具数为 0；已检查 TUI 的动态状态映射并补 zh/en 展示。该状态不是新的连接池或 Session 生命周期，合同记录在 docs/mcp.md，09 统一做 ADR coverage。
- wire `mcp.status` 与 `mcp.subscribe` 严格接收至多一个 Project / Session 标识；subscribe 由 viewId 定位，默认活动租约，`active:false` 为纯观察，`mcp.unsubscribe` 释放。服务只解析已注册 Project 和持久化 Session 的真实目录与信任，不调用 Session.open、不要求模型、不解密 Hooks 或 Provider。订阅在异步配置读取前登记取消状态；替换、退订、socket 关闭、superseded 和 shutdown 清理租约，迟到结果不能重新获取租约。wire client 重连重放当前订阅，已释放的 viewId 不重放。
- App 按 Project / Session 缓存状态并先用缓存，打开插入列表后台刷新，选中 Project 或进入 `/mcp` 时租用，离开与换范围释放；无项目一级汇总用只读观察保持实时。Project 目录/信任和 Session cwd 变化重建当前绑定，过期范围事件不会覆盖当前状态。回车、Tab、点击进入，服务名过滤、Esc/删除返回、第二次 Esc 清空均保留 Lexical 焦点；只读详情禁用发送，外部指针关闭也清掉查看命令，避免误发。
- 复用票 05 已安装的 beUI Popover、ScrollArea 和同一 listbox，没有新增组件来源或依赖。摘要零值隐藏，pending/auth/failed、空与首次加载、来源/工具数、配置错误独立行、错误与长摘要全文提示、disabled 选项与 cursor 均覆盖 zh/en。readonly 行保留正常文字不透明度。长摘要复现发现 Radix 的 intrinsic table wrapper 使窄行撑到 673.25px；只约束插入列表 wrapper 的固定表格宽度，并给 MCP 尾部预留图标与间隙，保留外部 composer / shell 几何。
- 依赖 `rtk proxy bun install --frozen-lockfile` 成功，Bun 报告 2.01s。未使用真实设置或凭证；没有 Electron、钥匙串、check:dev、aggregate check 或手工浏览器，主代理统一拥有这些适用验证。

### TDD 与失败记录

- wire 新命令 tracer 先红：0 pass / 1 fail，203ms 文件（0.96ms 用例），旧 parser 返回 undefined；补严格命令后 1 pass，157ms 文件。初次动态 spread 构造 TypeBox union 破坏 tuple 推导，focused tsc 报下游命令变成 never；改为显式六个目标变体，保留互斥与 additionalProperties:false。
- server 无 Session tracer 先红：0 pass / 1 fail，191ms 文件（20.33ms 用例），旧服务没有状态命令；接线后 1 pass，192ms 文件（31.20ms 用例）。后续配置错误路径断言因 macOS `/var` 与 `/private/var` 真实身份不同而失败，保留原结果，使用 realpath 取得预期物理路径；最小同例通过，198ms 文件。
- client reconnect tracer 先红：subscribeMcp 缺失，1 fail / 7 skipped，210ms；一次脚本使用错误 cwd 未写入测试，原筛选仅 skipped，没有行为证据。实现后一次关闭测试过早看见旧 connected，1 fail，271ms；fixture 改为等第三次连接凭证读取再检查 connected，1 pass / 7 skipped，323ms。没有产品重连重试或延时补丁。
- 浏览器 `/mcp` tracer 先红：1 fail，15.88s（14.975s assertion bound），原界面没有该行。接线后的中间单例失败分别为本地化占位符（15.68s）、配置错误误计作服务器失败（15.72s）、文本 matcher 正规化末尾空格（15.66s）以及窗口 dismiss 吃掉第二次 Esc（15.69s）。分别使用既有 {{count}} 插值、只数 server、精确 DOM textContent、Lexical Escape 阻止窗口重复关闭解决；首次绿灯 1 pass，804ms。
- 初始 3 例 MCP 状态/中文/窄屏增量通过，1.05s。App 场景首次 1 fail，2.37s，是 unmount 先关闭 socket 后无法再发 unsubscribe 的错误 fixture 假设；保留 socket 释放产品合同，改验范围切换的显式退订。合并五文件结果 17 pass / 2 fail，3.44s；仅两例票 05 旧断言不含新增 `/mcp`、以及误改的嵌套 description title。新增预期行、恢复 description 自己的 title 后最小两例 2 pass / 4 skipped，1.05s。
- 窄长摘要 tracer：最初 1 fail，827ms；确认可见后仍失败，1.87s；实际窄宽断言 673.25 > 358，838ms，固定 Radix table 后剩尾部溢出 8px，827ms。按图标/间隙约束尾部后，完整受影响五文件 24 pass，3.41s。没有放宽行边界、截断或几何断言。
- 指针关闭 tracer 1 fail / 4 skipped，1.91s（1.194s 用例），关闭后仍留下 `/mcp `；关闭详情清掉查看命令并在普通编辑时重置返回状态，最小 MCP component + App 两文件 6 pass，1.41s。其余技能、命令、shell 几何证据继续有效。
- 真实存储 Session view 补例首次 1 fail，254ms，只是 fixture 把 messageCount 错写为 2，实际 Core 记录为 5；改为对比状态操作前后的公开 sessions.list 完整结果，保留“不打开执行、不写历史”的要求。最小同例 1 pass，255ms（91.43ms 用例），另一 Core writer 持有执行租约时仍成功查询/订阅该 Session 的真实 Project 视图。

### 最终有效 evidence

- Agent Host 影响范围：`rtk proxy env -u NO_COLOR bun test packages/agent/tests/mcp/host.test.ts packages/agent/tests/e2e/mcp-host.test.ts packages/agent/tests/e2e/mcp-health.test.ts`，26 pass / 0 fail，123 expects，1.182s。覆盖现有共享、退休、虚拟宽限、授权、恢复、工具同步与实际 Session Runs。单例均低于 200ms。
- server / wire：`rtk proxy env -u NO_COLOR bun test packages/server/tests/wire.test.ts packages/server/tests/server.test.ts -t 'MCP views|MCP project view|MCP configuration read|MCP observers|wire |Goal commands|model service|plan mode commands|MCP status'`，19 pass / 0 fail，154 expects，495ms；包含原始 wire / Goal / 只读历史 / 凭证消费者，以及新状态、readonly observe、无项目、事件、配置错误、取消和三种租约释放，准确检查 29999/30000ms。另加上述 Session view 单例 1 pass / 0 fail，5 expects，255ms。首次 FakeTimers 清 native timer 诊断已用 shouldClearNativeTimers 正确清理；没有放宽截止断言。
- client：`rtk proxy bunx --no vitest run --project ui-node tests/client/wire.test.ts`，8 pass / 0 fail，443ms。
- Chromium：`rtk proxy bunx --no vitest run --project ui-browser tests/components/mcp-insertion.browser.test.tsx tests/components/skill-insertion.browser.test.tsx tests/components/builtin-insertion.browser.test.tsx tests/app/mcp-insertion.browser.test.tsx tests/app/layout.browser.test.tsx`，24 pass / 0 fail，3.41s；后续指针/编辑状态修复只使 MCP 两文件失效，对应最小两文件 6 pass / 0 fail，1.41s。先前 app skill-insertion 的 3 例及四个通过文件证据复用。
- TUI：`rtk proxy env -u NO_COLOR bun test packages/coding-agent/tests/tui/components/mcp-panel/mcp-panel.test.tsx -t 'deferred project MCP'`，2 pass / 0 fail，2 expects，539ms；zh/en 单例 25.51/5.10ms。
- focused tsc（shared / agent / server / ui / coding-agent）通过。changed-file oxlint 初次只报新 fixture no-useless-spread，去掉后通过。文档 `rtk proxy bun run docs:update` 与 `rtk proxy bun run check:docs` 通过，157 Markdown。最终 format / diff / hooks 结果在提交后追加或由主代理接续记录。
- 保持 claimed 待新代理评审与主代理统一验收；没有把局部通过称为 aggregate 或 hosted CI 验收。

- 最终增量静态：`rtk proxy bunx --no tsc -b packages/server packages/ui --pretty false` 退出 0，覆盖最后新增 Session fixture 与 MCP 编辑/校验变更。所有 28 个改动文件的 oxfmt 与 --check、所有改动 TS/TSX 的 oxlint、`git diff --check` 退出 0。最终 `rtk proxy bun run check:docs` 再次通过 157 Markdown。统一 check:dev / aggregate / 手工 Chromium 仍由主代理协调，不存在本票未解决的 focused 失败。
