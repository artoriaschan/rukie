# 03: TUI MCP 四层面板组件

**What to build:** 服务器列表、服务器详情、工具列表和工具详情采用同一通用 Design System 框架；组件只消费 props，不连接 Session。详见 [spec](../spec.md) 的面板框架与页面导航。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 使用 Rewind flow 槽位样式、permission Divider、remember 标题、通用 ListItem/状态/HintLine/ScrollBox；采用现有主题，不创建专用视觉原语。
- [ ] 服务器 project/user 分组与路径、稳定排序、状态与数量；工具名称与简介列表；hover 不改键盘 focus，单击回调直接激活项，边界滚动提示明确。
- [ ] 服务器详情渲染安全展示数据、授权/错误/工具数与动作列表，正文/动作焦点提示可见；工具详情渲染完整描述与格式化 schema。
- [ ] 标题/底部提示固定，正文独立滚动；上界14行且不超过 screen 提供的预算，有界焦点窗口，focus 变化不造成高度抖动。
- [ ] loading 自动等待后续 props、空配置路径、文件级错误/部分合法列表/全局失败重试与单服务器 failed 行均有可操作呈现；busy 动作反馈与结果有明确槽位。
- [ ] 同步 zh/en 字典；40×12、长名称/URL/schema、resize、theme 与其他面板预算保持可用，低于下限由 screen 暂停操作。
- [ ] 验证组件实际终端呈现与布局，不写镜像实现的纯快照测试；完整 `start` 接线回归由 04、05 覆盖。本票可与 02 独立开发。

## Context pointers

- [RewindPicker](../../../apps/neant-tui/src/components/rewind-picker/rewind-picker.tsx)、[ModelPicker](../../../apps/neant-tui/src/components/model-picker/model-picker.tsx)、[panel layout](../../../apps/neant-tui/src/components/panel-layout/index.ts)。
- [ListItem](../../../packages/tui/src/design-system/list-item.tsx)、[renderer README](../../../packages/tui/README.md)、[app i18n](../../../apps/neant-tui/src/i18n/locales.ts)。

## Comments

2026-10-06：设计已确认，尚未实施。本票不处理 Session、命令解析、输入分派或 OAuth 生命周期。
