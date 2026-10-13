# 05：C25 搜索聊天浮层

Status: ready-for-agent

Blocked by: 01, 03

**What to build:** 按 [spec](../spec.md#搜索聊天浮层) 与 rukie.pen C25，点击新聊天右侧搜索 icon 打开搜索聊天浮层：自动聚焦输入框，“聊天”分组列出全部未归档 Session，“快捷操作”分组提供新聊天与打开文件夹。

- [ ] 实现前在 DESIGN.md 增加“搜索浮层”角色：宽 520、圆角 20、`popover` 面板、缩放加淡入淡出与 reduced-motion 规则
- [ ] 改造现有 CommandPalette 为 C25 样式，不新增并行组件；占位符“搜索聊天”，打开即聚焦；结果区使用 A13 滚动条
- [ ] “聊天”列出全部未归档 Session，按更新时间排序，空查询不限条数；匹配 Session Title 与 Project 名称；右侧显示 Project 名称，不属于 Project 时留空；执行中显示加载 icon
- [ ] “快捷操作”只有新聊天与打开文件夹（等同现有添加项目）
- [ ] 方向键在结果与快捷操作间移动，Enter 执行，Esc 关闭并把焦点还给搜索 icon
- [ ] 打开与关闭缩放加淡入淡出；`prefers-reduced-motion` 下直接切换
- [ ] zh 与 en 文案同步
- [ ] 测试：shell browser 覆盖分组、过滤（标题与 Project 名）、归档排除、空查询全部列出、键盘导航、快捷操作、焦点恢复与 reduced-motion；更新现有搜索焦点恢复用例
