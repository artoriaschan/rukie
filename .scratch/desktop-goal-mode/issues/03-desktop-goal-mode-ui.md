# 03：桌面与 Web 目标模式 UI

Status: ready-for-agent
Blocked by: 01, 02

**What to build:** 按 [spec](../spec.md) 的「UI」一节以及 rukie.pen 中 C09 和 M03-C（C37、C38、C42、H17、H17-H、H18、H18-P 及浅色版），实现目标模式的开启、执行状态条与操作。

- [ ] C09「目标模式」行：开关；Run 进行中或存在未完成 Goal 时禁用并显示原因；开启后焦点回到输入框
- [ ] C42：MorphingModal，几何同 C36；「取消」获得初始焦点；危险色按钮「切换到完全访问并开启」，确认时先切换权限再开启；取消、Esc 或点击遮罩不开启
- [ ] `InputDraft` 增加「已开启目标模式」字段，随草稿切换；发送成功清除，发送失败保留
- [ ] C37：显示在权限模式右侧；悬停或聚焦变为 ×，点击、Enter 或 Space 取消开启；更换目标输入提示
- [ ] 发送：新聊天用 `session.create { goal: true }`，已有会话用 `session.goal_create`；支持只发图片
- [ ] C38：几何同 C32；按 spec 的状态表显示五种状态；首条消息单行省略，完整内容放进 tooltip 和可访问名称；只发图片时显示「图片目标 · N 张图片」；时间每秒刷新；删除、暂停、继续三个按钮；已达上限时继续按钮禁用
- [ ] Goal 推进中与暂停时的输入提示
- [ ] zh 与 en 文案；DESIGN.md 新增「M03-C 目标模式」一节；更新 `packages/ui/README.md`
- [ ] 测试：Chromium 覆盖开关、禁用、C42、C37、草稿、发送命令、C38 各状态（虚拟时钟）、删除不留占位、键盘与可访问名称、Light/Dark 与窄宽度几何；`bun run test:desktop` 或其中受影响的项目
- [ ] agent-browser 验收：`dev:desktop:web --isolated`，深浅色截图、窄宽度截图、控制台与网络无错误

## Comments
