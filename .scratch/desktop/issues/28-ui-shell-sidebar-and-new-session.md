# 28: ui 窗口外壳、侧栏、新会话与连接状态

**What to build:** wire client、store 与主窗口骨架：外壳、侧栏四分组、搜索浮层、欢迎页与输入框（发送、权限模式、模型、上下文环），以及断开与重连。见 [spec](../spec.md) 的「主窗口布局」中的窗口外壳、侧栏、主区域（欢迎页）、输入框、断开与重连、菜单与 tooltip。

Blocked by: 24, 27

Status: ready-for-agent

- [ ] `client`：连接、重连（每次重新 `getConnection`）、请求 `id` 关联、订阅与 `superseded` 处理；`store`：Session 列表、注册表偏好与连接状态归约；两者用 Vitest Node 环境测试
- [ ] 外壳、导航栏（只有首页）、侧栏四分组、折叠、显示与排序菜单、⌃1–⌃9、⌘N、⌘K 搜索浮层、置顶，偏好经 `preferences.set` 保存
- [ ] 欢迎页切换目标项目或默认工作区；首次发送 `session.create` 后切到对话视图
- [ ] 添加项目走 `host.pickProjectFolder`，浏览器开发模式改为手动输入路径
- [ ] 输入框：Enter/Shift+Enter/输入法、图片附件、权限模式菜单、模型与推理档次列表、上下文用量环与面板
- [ ] 连接状态：重连中、已断开与「重试」，断连期间禁止发送
- [ ] 会话更多菜单：置顶、复制、在 Finder 中显示、在终端中打开（开发模式隐藏后两项）
- [ ] 接缝：Vitest browser mode 渲染 `app` + 脚本化 wire server；覆盖键盘、焦点、可访问名称与窄窗口；完成后 GUI 浏览器验证
