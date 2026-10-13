# 05：C25 搜索聊天浮层

Status: resolved

Blocked by: 01, 03

**What to build:** 按 [spec](../spec.md#搜索聊天浮层) 与 rukie.pen C25，点击新聊天右侧搜索 icon 打开搜索聊天浮层：自动聚焦输入框，“聊天”分组列出全部未归档 Session，“快捷操作”分组提供新聊天与打开文件夹。

- [x] 实现前在 DESIGN.md 增加“搜索浮层”角色：宽 520、圆角 20、`popover` 面板、缩放加淡入淡出与 reduced-motion 规则
- [x] 改造现有 CommandPalette 为 C25 样式，不新增并行组件；占位符“搜索聊天”，打开即聚焦；结果区使用 A13 滚动条
- [x] “聊天”列出全部未归档 Session，按更新时间排序，空查询不限条数；匹配 Session Title 与 Project 名称；右侧显示 Project 名称，不属于 Project 时留空；执行中显示加载 icon
- [x] “快捷操作”只有新聊天与打开文件夹（等同现有添加项目）
- [x] 方向键在结果与快捷操作间移动，Enter 执行，Esc 关闭并把焦点还给搜索 icon
- [x] 打开与关闭缩放加淡入淡出；`prefers-reduced-motion` 下直接切换
- [x] zh 与 en 文案同步
- [x] 测试：shell browser 覆盖分组、过滤（标题与 Project 名）、归档排除、空查询全部列出、键盘导航、快捷操作、焦点恢复与 reduced-motion；更新现有搜索焦点恢复用例

## Implementation evidence

- Branch `feat/session-sidebar-05` based on integration `aad9a529` (01、02、03 已集成)，只实现本票；交付前合入 integration，当前返回 already up to date。
- 实现前补充 [Search overlay 角色](../../../DESIGN.md#search-overlay)。沿用已安装 beUI CommandPalette 和 A13 ScrollArea：520px 最大宽、20px 圆角、居中 `popover`，聊天结果内部滚动，快捷操作置于其下。无新组件或依赖。
- 搜索独立按 `updatedAt` 排序，空查询列出全部未归档 Session，按标题与 Project 名匹配；Project 右侧文案、Running 图标和中英文分组均完成。快捷操作调用既有新聊天与添加项目流程。共享键盘 cursor 跟随鼠标和 Tab 焦点；先释放搜索焦点再执行选中操作，路径弹窗关闭在清理焦点约束后恢复入口。
- [ui 使用说明](../../../packages/ui/README.md) 与设计文档一致。架构仍沿用 spec ADR Coverage 的 ADR-0029 / ADR-0008；本票局部布局和交互没有新增模块归属或持久化取舍，无需新 ADR。

## Verification evidence

- 公共接缝为 App + fake wire 的 Chromium browser 测试，按 spec 授权。完整命令、失败诊断与增量复验日志保存在本地 `/tmp/rukie-session-sidebar-evidence/05-verification.md`。
- TDD：结果首轮在缺失 Search chats 入口失败；Tab 聚焦 Open folder 后 Enter 误选首条聊天的回归先红后绿。布局用例发现并修复 Radix 长标题扩宽（scrollWidth 569 / clientWidth 502）；文件夹提交后焦点丢到 body 的真实回归先失败，再将恢复移到 modal cleanup 后通过。两次测试预期修正（默认首页文案、隐藏滚动条 ARIA 定位）单独记录，未把预期修正声称为产品修复。
- 已通过：全部未归档／空查询超过 8 条／独立更新时间顺序／标题与 Project 过滤／Running；520/20 居中、420×300 Light/Dark clamp、长标题无横向溢出、279px 结果滚动区、8px A13、快捷操作不随结果滚动；实际 reduced-motion 媒体下逐帧检查面板与背景直接切换；键盘跨分组、新聊天、host picker、路径弹窗与最终入口焦点恢复。
- 相关增量验证通过：既有 shell 项目搜索、选择结果、Tab trap、01 会话行菜单与 hover、03 归档后搜索隐藏，以及 host folder 的选择／取消／不支持三个路径。
- 本票 changed-file 格式／lint、`tsc -b packages/ui` 和 docs checks 已通过。一次全量验收及 agent-browser 手工 GUI 验收由 06 统一执行，未在本票重复运行；spec 保持 claimed。
