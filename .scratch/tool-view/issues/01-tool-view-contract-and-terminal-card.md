# 01: Tool View 契约与 bash terminal 卡

**What to build:** 打通 Tool View 全链路：工具声明 presenter，Session 把 view 附在工具事件上并在 resume 时从 Transcript 重算，TUI 按 view 渲染新卡片骨架。前台 bash 以 terminal 卡呈现（含退出码），其余工具暂为 generic 卡。见 [spec](../spec.md) 的「Tool View 契约」「Presenter」「事件与 resume」「类别与主题」「TUI 工具卡」。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `@neant/shared` 提供 Tool View 的 TypeBox schema（call / result 各 card 变体、`kind`、`displayKey`），不含自然语言字段
- [ ] 工具可选声明 `presentCall` / `presentResult`；presenter 抛错或参数非法时 view 为 `undefined`，工具调用照常完成
- [ ] `tool_execution_start` / `tool_execution_end` 携带 view；resume 后 `messages` 投影重算出与 live 相同的 view；工具不存在时为 `undefined`
- [ ] `subagent_event` 内的工具事件带 view；Headless stream-json 输出含 view，text 模式输出不变
- [ ] bash 结果 `details` 含 `exitCode`，被杀时含 `signal`；前台 bash 出 terminal view，后台 bash 出 generic view
- [ ] TUI 卡片：运行中 `●` 600 ms 同步闪烁、失焦常亮；完成后按 `kind` 类别色 `•`；错误红 `✗`；`outcomeUnknown` 仍为 `?`
- [ ] 头部为加粗本地化工具名（zh / en 字典补齐全部内置工具 `tool.<id>`，缺失时 id 首字母大写）+ `Name(command)` 或 `Name(args)`；结束后显示耗时 chip，resume 后由时间戳重算
- [ ] 正文 `⎿` 下折叠为 3 行，只多一行时不折叠，提示 `… +N lines (ctrl+o to expand)`；运行中无正文时显示 `Running… (Ns)`；退出码 / 信号不受折叠影响
- [ ] 删除按工具名推断颜色的启发式，状态点与工具名色共用 `kind` 映射；主题新增 `toolDot*` 五个 token
- [ ] Agent Core e2e（`createSession` + fake model）与 TUI e2e（`start` + headless terminal）覆盖以上行为；依赖旧 `name + JSON` 摘要的测试同步更新
