# Context Report 面板交付

## 行为与范围

用户将恢复后缺少 `/context` 消息的问题改为产品交互调整：报告在独立面板展示，默认全部展开，不再记录在消息流中。

`/context` 读取打开时的当前 Context Report，保留现有网格、模型、总量、分类、资源摘要与明细。关闭再打开刷新快照；后台回复不改变正在阅读的快照。面板支持方向键、PageUp/PageDown、Home/End、滚轮、resize 与 40×12，Esc、Ctrl+C 和底部提示返回聊天。Interaction 临时接管并恢复报告阅读位置，聊天阅读位置与后台 Run 保留。面板不持久化，Resume 后重新打开读取恢复会话的当前报告。

删除 conversation 的 context-report 条目及注入方法、Transcript 搜索的报告分支、收起状态与 `all` 参数提示。模型上下文和 Transcript 不包含面板报告。

## 验证

- 新的公开 TUI 面板测试在修改前失败：报告默认没有逐项明细，并且仍作为用户样式的消息显示；修改后通过。
- 报告文件测试 13 pass、0 fail、113 assertions，2.35s。覆盖全部明细、中英文、网格颜色、provider 静态快照、小窗口与 resize、滚轮及键盘滚动、输入与粘贴隔离、审批接管与恢复、真实关闭/Resume、聊天阅读位置与后台响应。
- 相关报告、slash command、权限、jobs panel、conversation 测试 63 pass、0 fail、1373 assertions，16.60s；后续报告文件修订另有上述 focused 通过记录。
- 阅读位置场景改用已有虚拟时钟：单独运行从 1224.61ms 降至 464.62ms，最终报告组内为 201.10ms，避免等待逐字绘制的真实定时器。
- `bun run check:dev` 与 `git diff --check` 通过。
- `env -u NO_COLOR bun run check` 的静态阶段通过；测试实际结果为 3144 pass、2 fail、17942 assertions、286 files，121.97s，完整检查未通过。
- 其中 Transcript 搜索旧用例要求报告进入消息流，遗漏了该消费者的断言更新。已改为面板接管搜索键，返回聊天后搜索报告无匹配；全部搜索文件 9 pass、0 fail、22 assertions，2.66s。
- 另一项为 jobs panel 的 reading/follow 用例在第三条输入提交后等待模型调用超时，单独复现 1 pass、0 fail，695.62ms。后续 jobs + search 文件组合为 20 pass、1 fail：reading/follow 通过，但 en_US 的 settled exit-code 用例在下一条输入提交处同样超时；该用例单独复现通过，484.13ms。两处超时均显示下一条输入留在草稿，尚未确定根因，未修改后台任务结算行为，不据 focused 通过宣称完整检查通过。
- 最后仅收窄命令后的阅读恢复条件，保持其他已有面板行为；报告文件重新通过。按仓库规则以 focused 验证局部修订，不重复完整检查尝试消除偶发失败。

## ADR coverage

沿用 ADR-0006 的全屏、输入与阅读位置约定，复用已有 Frontend 面板和滚动恢复机制；Context Report 仍为模型上下文之外的报告，没有改变 Session Store、Transcript、Agent Core 或 renderer。产品交互由 TUI README 说明，无新增长期架构决定。
