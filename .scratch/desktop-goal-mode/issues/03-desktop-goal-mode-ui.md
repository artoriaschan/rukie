# 03：桌面与 Web 目标模式 UI

Status: resolved
Blocked by: 01, 02

**What to build:** 按 [spec](../spec.md) 的「UI」一节以及 rukie.pen 中 C09 和 M03-C（C37、C38、C42、H17、H17-H、H18、H18-P 及浅色版），实现目标模式的开启、执行状态条与操作。

- [x] C09「目标模式」行：开关；Run 进行中或存在未完成 Goal 时禁用并显示原因；开启后焦点回到输入框
- [x] C42：MorphingModal，几何同 C36；「取消」获得初始焦点；危险色按钮「切换到完全访问并开启」，确认时先切换权限再开启；取消、Esc 或点击遮罩不开启
- [x] `InputDraft` 增加「已开启目标模式」字段，随草稿切换；发送成功清除，发送失败保留
- [x] C37：显示在权限模式右侧；悬停或聚焦变为 ×，点击、Enter 或 Space 取消开启；更换目标输入提示
- [x] 发送：新聊天用 `session.create { goal: true }`，已有会话用 `session.goal_create`；支持只发图片
- [x] C38：几何同 C32；按 spec 的状态表显示五种状态；首条消息单行省略，完整内容放进 tooltip 和可访问名称；只发图片时显示「图片目标 · N 张图片」；时间每秒刷新；删除、暂停、继续三个按钮；已达上限时继续按钮禁用
- [x] Goal 推进中与暂停时的输入提示
- [x] zh 与 en 文案；DESIGN.md 新增「M03-C 目标模式」一节；更新 `packages/ui/README.md`
- [x] 测试：Chromium 覆盖开关、禁用、C42、C37、草稿、发送命令、C38 各状态（虚拟时钟）、删除不留占位、键盘与可访问名称、Light/Dark 与窄宽度几何；`bun run test:desktop` 或其中受影响的项目
- [x] agent-browser 验收：`dev:desktop:web --isolated`，深浅色截图、窄宽度截图、控制台与网络无错误

## Comments

- 实现：C09、草稿所属权限与 Goal 开关、C37、文字/图片/纯图片发送、严格实时 Goal 读取与 C38 五态/计时/操作、zh/en 文案、DESIGN M03-C 和 UI README 已实现。沿用已安装 Button、Tooltip、MorphingModal 和 DropdownMenu；C38 为领域状态组合，注册库没有对应 Goal 投影布局。C09 使用 CheckboxItem 作为唯一激活面，Switch 配色的装饰轨道避免嵌套按钮。C42 只增加局部448px/36px底栏契约，保留现有 C36 和共享 Modal。
- TDD：公开 App/wire 与状态组件边界，覆盖确认成功/失败/等待、失败及发送期间编辑保留、草稿导航、权限后改、C37 Enter/Space/hover、禁用原因、纯图片 Goal、普通暂停/运行输入路径、状态与虚拟时钟999/1000ms、删除无占位、深浅色与窄屏。布局基线 C32/compact5例先通过，再修改布局。
- 本地验证：focused Chromium48例中47通过，唯一中文按钮名称断言修正后单例通过；Node reader/wire2例通过。一次完整 `bun run test:desktop --maxWorkers=1 --no-file-parallelism`：53文件306测试通过，218.64s。类型、变更文件 lint/format、UI Knip、文档155、test-policy458、scratch、typography、diff 检查通过。
- 实际浏览器：隔离 sidecar、memory 加密与 loopback fake；新建图片 Goal、暂停、继续、删除及 C37/C38 的 Light/Dark/420px 截图已保存。C38宽752高40，紧贴高100输入框；窄屏宽340，页面420无横向溢出。网络153请求无失败。
- 待完成：控制台实际发现10次 Radix FocusScope 与 Modal 焦点锁递归错误，保留错误日志并阻止验收。将按菜单卸载事件交接 C42，新增减少动态效果的公开焦点/错误回归，再只复验 C42；已有桌面包和 C38几何证据继续有效。最终全局评审及 ADR coverage 由协调者完成，工单保持 claimed。

- 后续修复与复验：公开回归先复现远端 Goal 完成后旧 C37 重现；收到未完成 Goal 时仅清理草稿开关，输入与附件保留，发送与呈现共用同一派生标记。C09 的选中回调改为在 `onCloseAutoFocus`（菜单已卸载）中交接 C42，未修改共享 Modal/菜单或增加定时等待。减少动态效果的自动 focus/error 用例未复现手工捕获的递归（明确保留此限制）；实际浏览器局部复验则从10次 RangeError 变为0次，确认两种主题/窄屏取消焦点、Tab/ShiftTab/Esc 和确认后输入焦点。
- 增量证据：修正后 App12例中10通过；两个原本同步读取弹窗几何的用例改为等待弹窗可见，精确几何断言保持原值，相关2例通过（3.97s）。UI 类型与4文件 lint 通过；完整桌面306结果与未受影响 C38截图继续复用，不重复包级验证。局部手工复验150网络请求无失败，控制台仅开发提示与减少动态效果提示；自有浏览器与隔离启动器已关闭并确认进程退出，临时数据由启动器清理。
- ADR coverage：核对 spec 已有覆盖，UI 权限选择沿用 ADR-0014，wire 沿用 ADR-0031，组件向下依赖沿用 ADR-0029；C37/C38/C42 和内存草稿交互属于 DESIGN 的局部约束，无新增长期架构取舍。协调者继续负责合并后组合评审与 spec/ticket 一起关闭。
- 已快进合并集成分支 `b1955bdd88641f2d916ecffc6434da760c190c23` 的 Core 初始准入修复；不改变本票 UI 源码，复用原证据。工单仍 claimed，等待协调者最终评审。

### 最终交付关闭

- C09/C37/C38/C42、图片目标、草稿与实时状态路由、双语文案及 DESIGN/README 完成；焦点交接修复经局部复验通过。两轴评审完成，唯一 UI README 的原子创建文案 P2 已修正为原子接纳 Goal/task 后经 Hook 放置首条人类输入。ADR 覆盖复核完成，见 [spec](../spec.md#adr-coverage)。
- 复用桌面包 **53 文件、306 测试通过**；随后仅复验失效的 C42/输入路由 App **12 例**（10 pass 加修正同步后的 2 pass），Node 与未受影响 C38 证据继续有效。最终实际浏览器 **0 page errors、150 请求、0 失败**，Light/Dark/窄屏焦点和几何通过，自有浏览器及隔离启动器已关闭；未运行原生 Electron。初始 `check:dev` 及受影响增量静态检查通过。
- 组合 Core e2e 1510 pass、准入/恢复/时间/runtime 43 pass、wire/client/presenter focused 通过；早先 canonical general 518 pass/10 fail、coding 1512 pass/32 fail、server/shared 107 pass/1 fail 仍记录为失败。后端 `64ea0ef` CI 全绿不是最终 HEAD 验收；最终推送后最新 CI 待核对。三票与 spec 一起 resolved，表示实现、文档、评审和适用本地验收完成，不代表 CI 全绿或合并。
