# 05: 面板输入过滤

Status: resolved

Blocked by: 04

**What to build:** 面板里直接打字即可过滤，按名称、spec 或 provider 显示名做子串匹配，不区分大小写。有输入时跨 tab 平铺显示结果，清空后回到 tab 视图。Esc 先清空输入，输入为空时再按 Esc 才关闭面板。粘贴的内容同样作为过滤输入。见 spec 用户故事 6。

- [x] 终端断言：输入 provider 显示名或 spec 片段，都能列出跨 tab 的匹配结果
- [x] 终端断言：没有匹配时显示空状态；Backspace 删到空时回到 tab 视图
- [x] 终端断言：Esc 第一次清空输入，第二次关闭面板

## Comments

- 使用已授权的 view 投影及 app start/headless terminal 测试边界，先重现缺少过滤导出、面板忽略粘贴的失败，再实现过滤。
- view 按名称、spec、provider 显示名做不区分大小写的子串过滤；仅搜索可见 tabs，保留 provider 排序。面板输入与粘贴共享过滤输入，空结果有提示，Backspace 清空恢复 tab 与其焦点；ref 同步更新使连续 Esc 先清空再关闭，连续筛选、↓、Enter 选择正确跨 tab 模型。
- 更新 TUI README 与 zh/en 文案。沿用 spec ADR Coverage：Frontend 事实投影与本地化沿用 ADR-0008，过滤草稿为局部可撤回交互，无新增长期架构取舍。
- 验证：view/model-picker、chat/model-switch、chat/model-picker-filter 共 9 项通过；check:dev（格式、lint、类型、Knip、tracker、docs、边界、test-policy）通过。冷启动过滤场景约 1.06 秒，主要为真实 Session/app 初始化与 headless terminal 渲染；同进程组合运行约 0.2 秒，无固定等待。完整 check 留给集成分支最终验收。

- 合并 integration e8acc36f 后的 focused run：8/9 通过，既有 direct /model 用例在初始空屏等待时触发 `flushTerminal` 的真实 1 秒 parser deadline；过滤场景仍通过（305ms）。最小 direct /model 单例随后通过（1.11s）；失败点在面板打开前，无证据指向本票过滤改动，未修改共享 timeout。保留该次失败供集成验收判断，不能把单例通过视为失败套件通过。
