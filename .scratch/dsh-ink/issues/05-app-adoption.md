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
