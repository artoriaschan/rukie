# 14: C01 统一应用外层壳与标题栏

Status: resolved

Blocked by: 13

**What to build:** C01 为整体布局唯一维护源，组合 C02/C03，按 H01/L-H01、H08/L-H08、H09/L-H09、P01/L-P01 更新外壳。用户授权背景色、圆角和栏间分割线：左导航与中间栏之间无边框，中间栏与右主区域有分割线。首页/会话区域展示会话标题及标题分割线；设置为完整无标题标题栏。会话标题栏左侧前进/后退与显示隐藏侧边栏 icon 按钮；设置左侧前进/后退 icon 按钮；与 macOS 原生红绿灯垂直中心对齐。消息、输入及标签/Session 联动既有行为保持。

- [x] Pencil MCP 读 C01/C02/C03 与指定深浅色整页稿，建立布局与消费者基线；先更新 DESIGN.md
- [x] 复用 beUI 与统一壳，修复背景/圆角/分割线/标题栏按钮与页面分支；前后导航与侧栏开关实际可用
- [x] 覆盖首页、会话、标签、设置的受影响布局、窄屏与焦点交互，检查消息/输入滚动保持
- [x] 最小适用检查、一次 Chromium/mock 壳验收、独立复核与 ADR Coverage 后关闭

## Verification scope

实施代理维护一份外部记录。先一次列全设计差异与消费者，集中修复后按最小集合验证，复用已有包级/静态证据；新提交/交接/评审不重跑。同原因再次失败停止重试诊断。无 Electron/打包/钥匙串验收。现有用户 Electron 保留；mac 原生按钮几何以当前窗口配置及浏览器壳参照验证，不将浏览器证据称为原生验收。

## Implementation evidence

C01 单一壳色与44px标题栏，C02/C03统一52px左轨/268px中栏、12px工作区/16px外壳圆角及4px右下inset；删除外壳left/top多余border，中栏仅保留right divider，壳独立divider使用Pencil Dark #ffffff1a / Light #0d0d0d1a，统一C02/C03及title divider。设置仍使用既有C03与provider工作区，标题栏不展示Session标题/分割线/侧栏toggle；首页/Session保留标题与会话操作。既有beUI Button增加真实Back/Forward，恢复Session/项目/new-chat草稿与设置视图；导航不改变已运行Session行为。标题栏图标中心y22，macOS窗口选项显式trafficLightPosition x16/y16，源于C01原生按钮参考；未启动真实Electron，未宣称原生几何验收。H09中的独立标签/Side Pane功能当前未实现，沿用DESIGN条件合同；既有Session summary联动保持。

验证记录由实施代理单独维护在外部verification.md。复用已有desktop包验收与静态基线，仅失效消费者局部验证：layout browser2例通过（深浅/1280与420、字体14/18、sidebar开关、Transcript滚动/resize及composer保留）；titlebar drag与菜单1例通过；新增Back/Forward跨两个Session与设置、独立草稿1例通过。Node BrowserWindow mock既有IPC合同1例通过（7 filtered，336ms）。UI/desktop类型检查及任务TS lint通过；最后导航cleanup测试修改仅该例增量验证通过。未运行包级全套、Core、CI或原生。

一次完整agent-browser Chromium/mock壳验收涵盖Light/Dark首页、Session、settings宽屏，以及Session/settings窄屏；浏览器错误为空，仅QA favicon404。Back/Forward、sidebar overlay和键盘Tab可见focus通过；自有QA/browser/wire子进程均已关闭，用户Electron保留。最终父代理发现Session divider仍用了GitHub全局border，按Pencil精确stroke追加壳独立token后，只复验layout颜色断言及实际Session分割线深浅区域；其他GUI/导航/类型/Node证据复用。GUI Session截图使用空mock Transcript，消息/composer滚动保留由公开layout测试验证。截图与日志放在外部证据目录。初始命令project discovery错误、Tooltip wrapper定位与新断言文案错误分别记录；修正后只复验失效scope，未放宽断言。

Standards/Spec独立只读复核完成；Standards建议新导航test应在获得wire后立即注册onTestFinished cleanup，已修改，render/unmount失败仍独立stopWire与恢复viewport。Spec无明确偏差。ADR Coverage：壳样式、前端临时view history和窗口坐标属于既有ADR-0029/0035责任边界，没有改变存储/IPC/Session执行架构，无需新ADR。父代理核对最终 diff、清理补丁、实际深色会话/浅色设置截图及验证记录，关闭 Standards 发现；divider 的最终局部补丁另行检查。

最终关闭：新的 merger 将 `cd7fa2e1` 快进集成，父代理复用现有验证，未重跑。最终布局 2 pass（1.90s）、导航 cleanup 单例 1 pass（1.51s）、窗口配置 mock 1 pass（336ms）；其他有效消费者及类型证据见记录。H09 尚未实现的独立标签功能仅保留条件设计合同，不将其计作已实现或已验收；本票实现已存在壳的指定修改。原生红绿灯真实显示未验收，现有用户 Electron 仍为旧构建。14/spec 同步 resolved，以本地结果交付，不等待 CI，未授权合并 main。
