# 05: 迁移 TUI 生命周期、输入、滚动与选字

Status: in-progress
Blocked by: none
Type: task

见 [spec](../spec.md) 与 [spike evidence](../spike-notes.md)。

应用直接使用 dsh 新 API；包括 runTui、全部页面/模态框、Chat、timeline/search、面板及测试 harness。04 独立拥有图片模块，05 只做必要 exports 接线，避免共享模块同时编辑。

- [ ] 启动采用 renderSync/new stream options，完整树由 AlternateScreen 包裹；显式产品 Ctrl+C/console 配置；错误流、信号、raw mode、resize、退出恢复均可注入
- [ ] 键盘读取 useInput(input,key,event)、isPasted/keypress；pointer 改 Box typed events；wheel 自动路由只滚一次，不转成旧 union facade
- [ ] 所有 panel scroll 使用 ScrollBoxHandle/getters/DOM refs；stable ID -> DOMElement 的阅读锚与 source offsets 归应用负责，恢复 scroll top/follow 与宽度重排位置
- [ ] Chat timeline/pinned prompt/search 等通过实际 DOM refs 和 wrapped positions 查找；MCP followOnReachBottom=false 等阅读策略显式由应用保持
- [ ] 选字通过自身渲染根获取状态；产品 clipboard host 仍拥有异步 copied/sent/unavailable/stale，不先执行 dsh native clipboard 再报告成功；modal focus 隔离与复制后反馈验证
- [ ] job-card/logo/status-icon 的 animation tuple、size/focus hooks 与页面导航更新；保留 Session/Interaction 语义及共存面板
- [ ] 迁移 start/headless terminal/virtual clock helpers 与公共应用测试，保留 streaming、resume、cancellation、history、atomic editor、permissions/jobs/subagents/MCP 的端到端覆盖

## 05 interim（未完成）

已采用 renderSync/AlternateScreen、原生输入与一次 wheel 路由、DOM/source 阅读位置注册表、root selection 读取与产品 async host 生命周期、Sinon virtual clock 和原生 headless component harness。修复原生 nested/fresh-layout seek、mixed viewport selection、atomic wide owner、decorative soft-wrap 与 scheduled fatal exit，保持默认 dsh selection fence 并显式设置产品装饰排除。

关键公共用例继续验证；广域非图片 TUI 检查发现卡片/详情/小窗口布局与若干完成同步回归，05 保持 claimed/in-progress。不得用删除公共覆盖或旧 API facade 跳过；完整 aggregate 留给 06。

后续共享根修复：原生 handoff quarantine 的 process-global deadline 在虚拟 clock 恢复后污染后续 TUI 输入；公开两个 root + 119/120ms 边界 + cleanup/clock restore 后新 root 用例先红后绿。改为每个 Ink 独立工厂，并同时更新 useInput 与 App 的 wheel admission。受污染的广域用例已终止，保留日志作诊断证据；在 owner 修复后仅重新执行一次更广域检查。

共享 focused 进展：plan review/thinking/gesture/return button/native host fixtures 46 pass、192 assertions、4.03s；click owner/keyboard/geometry 重置与稳定文本选择合计 21 pass、57 assertions、2.12s。Readonly compact multiline 首行预览使 6 个 40–80×12 共存 Interaction 场景恢复；Markdown 内容取消 shrink 防止 long plan ScrollBox 高度误为一行。测试在模型完成后等待 inactive footer 再采集点击坐标，在第一 click transport 完成后控制 499/500ms 严格边界，保留原点击/复制断言。

## Latest complete product frontier

集成 `70aaea0b` 执行 `env -u NO_COLOR bun test --parallel=4 packages/coding-agent/tests/tui`：1024 pass / 9 fail / 5555 assertions / 122 files，52.96s。已合入的图片、Search、Side、Rewind、Concurrent 与时钟优化共同通过；9个剩余失败来自 Logo Kitty header（04）、image-model-notice Goal title 共存2项（04）、tool-tooltip Unicode 小视口、composer token Escape/rearm 与 rewind suppression2项、jobs-panel MCP ownership/expanded card/stopped signal3项。按实际失败栈聚焦修复，不再次重复全域定位。05仍in-progress，06仍blocked。
