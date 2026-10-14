# 03：创建项目、统一信任确认与目录行

Status: ready-for-agent

Blocked by: 02

**What to build:** 按 [spec](../spec.md#创建项目c27与统一信任确认c28) 与 [目录行](../spec.md#目录行c27-与-c29-共用)，把创建项目弹窗改为 pen 的 C27，把信任确认改为多目录的 C28，并实现 C27 与 C29 共用的目录行。

- [ ] 先按 pen 的 C27–C31 重写 DESIGN.md 的 Project directories and trust 段落，加入 `path-tooltip` 与 `destructive-soft` 作用域 token，保留详情卡锚定规则；再改 UI
- [ ] 开始改动前记录 layout preservation 基线（project-directories、layout 浏览器测试）
- [ ] C27：480px，名称输入框自动聚焦；空状态入口；目录列表与“添加文件夹”行；首个目录自动填名；无名称或无目录时禁用；点击“创建项目”打开 C28
- [ ] C28：416px，“信任这些文件夹吗？”；高度受限的 ScrollArea 目录列表（完整路径、主要徽标、编辑场景的“新增”标记）；pen 说明文案；纵向全宽操作，主操作依场景为“信任并创建 / 信任并保存 / 信任”；取消返回表单并保留输入；旧 Project 补确认与 Session Move 复用
- [ ] 删除手动路径输入；`host.pickFolder` 返回 `unsupported` 时显示 alert，入口保持可用；同步 ui README
- [ ] 目录行组件：basename 加重名时的父目录区分；主要徽标；hover 或 focus-within 显示 ghost“设为主要”（空间预留）；移除按钮（最后一个目录禁用，移除主目录时由下一个接任）；行上方 4px 的完整路径提示，使用 `path-tooltip` token
- [ ] 项目弹窗统一外观（圆角、内距、标题行、关闭按钮、32/36px 控件），不改动 MorphingModal 全局默认值
- [ ] zh 与 en 文案同步，删除不再使用的键
- [ ] 扩展 fake wire helper（`name`）；更新 project-directories 与 session-move 浏览器测试中受影响的断言，按 spec 补充创建、信任、选择器回退与目录行用例；layout 回归通过

## Comments
