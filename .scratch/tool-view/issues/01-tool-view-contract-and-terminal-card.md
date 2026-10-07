# 01: Tool View 契约与 bash terminal 卡

**What to build:** 打通 Tool View 全链路：工具声明 presenter，Session 把 view 附在工具事件上并在 resume 时从 Transcript 重算，TUI 按 view 渲染新卡片骨架。前台 bash 以 terminal 卡呈现（含退出码），其余工具暂为 generic 卡。见 [spec](../spec.md) 的「Tool View 契约」「Presenter」「事件与 resume」「类别与主题」「TUI 工具卡」。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `@neant/shared` 提供 Tool View 的 TypeBox schema（call / result 各 card 变体、`kind`、`displayKey`），不含自然语言字段
- [x] 工具可选声明 `presentCall` / `presentResult`；presenter 抛错或参数非法时 view 为 `undefined`，工具调用照常完成
- [x] `tool_execution_start` / `tool_execution_end` 携带 view；resume 后 `messages` 投影重算出与 live 相同的 view；工具不存在时为 `undefined`
- [x] `subagent_event` 内的工具事件带 view；Headless stream-json 输出含 view，text 模式输出不变
- [x] bash 结果 `details` 含 `exitCode`，被杀时含 `signal`；前台 bash 出 terminal view，后台 bash 出 generic view
- [x] TUI 卡片：运行中 `●` 600 ms 同步闪烁、失焦常亮；完成后按 `kind` 类别色 `•`；错误红 `✗`；`outcomeUnknown` 仍为 `?`
- [x] 头部为加粗本地化工具名（zh / en 字典补齐全部内置工具 `tool.<id>`，缺失时 id 首字母大写）+ `Name(command)` 或 `Name(args)`；结束后显示耗时 chip，resume 后由时间戳重算
- [x] 正文 `⎿` 下折叠为 3 行，只多一行时不折叠，提示 `… +N lines (ctrl+o to expand)`；运行中无正文时显示 `Running… (Ns)`；退出码 / 信号不受折叠影响
- [x] 删除按工具名推断颜色的启发式，状态点与工具名色共用 `kind` 映射；主题新增 `toolDot*` 五个 token
- [x] Agent Core e2e（`createSession` + fake model）与 TUI e2e（`start` + headless terminal）覆盖以上行为；依赖旧 `name + JSON` 摘要的测试同步更新

## Answer

Tool View schema 与纯 presenter 包装已接入 Session 工具事件和 `messages` 投影；view 不进入模型上下文或 Transcript。前台 bash 保存退出码和信号，显式后台或超时转后台结果为 generic。TUI 卡片使用本地化名称、kind 主题颜色、共享 600ms 闪烁与终端 focus 快照、时间戳耗时、3 行折叠与独立退出状态。既有 todo/question/goal 摘要记录暂保留，后续 03 分流与 06 presenter 会替换其专用投影。

## Comments

- 接缝：`createSession` + fake model；TUI `start`/`startWithClock` + headless terminal；CLI 真实子进程。Presenter 异常场景在现有 bash 工具工厂注入作者 presenter，实际 execute 未替换，所有断言仍观察 Session 事件与 messages。
- Red：`rtk proxy bun test packages/agent/tests/e2e/bash.test.ts -t 'resolves workdir'` 因开始/结束事件缺少 view 失败；`rtk proxy env -u NO_COLOR bun test apps/neant-tui/tests/e2e/tool-view.test.ts` 因缺少 `Bash(command)` 与退出状态失败。
- Green：bash 文件 11 pass / 34 assertions / 3.51s；新增 throwing presenters 1 pass / 38.88ms；子代理 view 转发 1 pass / 54.98ms；CLI text/stream-json 2 pass / 233.89ms 与 232.50ms；后台/超时转换 2 pass / 439ms；窄屏后台组回归 1 pass / 197.45ms。
- 最终 TUI 相关 8 文件：63 pass / 339 assertions / 7.05s。包含本地化、退出状态不受折叠影响、4 行不折叠、同步闪烁、失焦常亮、1004 退出恢复、resume、权限、状态栏、旧摘要记录、类别色 fixtures。旧动画回归已改虚拟时钟，单例从 745.10ms 降至 209.49ms；新增 blink 场景约 96–131ms。
- `rtk proxy bun run test:tui` 初次运行 937 pass / 23 fail / 49.52s：失败均为旧工具名称/摘要/颜色 fixtures；随后更新相应断言与专用记录兼容，并以相关文件和失败用例复验通过。未重复全量运行；integration 最终 aggregate gate 由主代理执行。
- `rtk proxy bunx --no -- tsc -b`、`oxlint`、`knip` 和 `git diff --check` 均通过。格式检查最后发现一个断言换行，交付前修复并复验。
- 原有 bash 顽固进程中止场景约 3.02s，验证真实子进程的 SIGTERM→SIGKILL 升级契约，虚拟父进程时钟无法替代它。
- 自分支确认基于 `codex/tool-view`，交付前合并 integration tip（Already up to date）。

### Review 修复验证（2026-10-07）

- todo、question、plan、subagent / fork / send / list 的 start/end/resume view 均带 `kind: task` 与 displayKey。read 截断、继续读取 offset 和 bash 完整输出路径是结构化事实，保持模型文本不变。`task-views.test.ts` 8 项与 `truncated-tool-views.test.ts` 4 项通过。
- `bun run check:dev` 通过；最终 aggregate 在 integration branch 统一执行，结果由 spec 验证记录补充。
