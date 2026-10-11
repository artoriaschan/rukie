# 10: 默认推理等级可选择、保存并生效

Status: resolved

Blocked by: 09

**What to build:** 用户明确选择补齐模型级默认推理等级。使用既有 beUI Select 还原 C16，保存桌面模型默认值，并在新建 Session 或仅采用模型时生效；显式推理等级优先，恢复保留已保存选择。

- [x] 对照当前 C16 实现默认等级 Select，与真实可用等级一致
- [x] 桌面模型配置保存默认值，编辑不丢失已有映射和兼容字段
- [x] server 将模型默认值接到既有 Session API，显式选择及恢复优先，不改变 TUI/Core 全局默认
- [x] 最小公开行为 red/green、适用静态检查及 Chromium/mock 验收通过
- [x] 复用统一验证记录，独立评审与 ADR Coverage 完成；不重复交接测试，不启动 Electron

## Implementation evidence

独立新代理 default_reasoning10_implementation_fresh 在独立 worktree/branch 实施；只读调查代理不复用。验证记录归外部 rukie-default-reasoning-evidence，主代理读取并复用其中已通过结果。当前禁用空 Input、模型 schema 缺字段及 server 新建/切换接线缺口已确认；本票不把外观恢复当作执行生效。

## 最终交付

`d3defa71` 合入 integration。桌面模型可选 defaultThinkingLevel 保存到已有 provider JSON，不新增数据库迁移或改变 Core/TUI/全局默认。按已锁定 pi-ai 支持合同生成选项：基础等级允许省略映射，xhigh/max 需显式映射，null 禁用；自动清除默认元数据，关闭当前默认等级清除失效选择，保留既有 deep 等映射及 compat。beUI Select 宽 188px、分组高 60px、控件高 36px；菜单局部向上展开，避免既有滚动区裁切，Escape 仅收起菜单。

实际模型请求单例验证默认 high/deep、仅采用模型、显式 low/light 与恢复后仍请求 light，1 pass（332ms）；数据库公开保存/重开及无效默认拒绝单例 1 pass（120ms）；新增浏览器单例最终 1 pass（1.94s），既有 chip 消费者单例 1 pass（1.31s）。源码完成后 check:dev 通过一次，之后文案/尺寸/就绪条件仅做局部检查。初始缺 Select、保存 400、Escape 误关弹窗、浏览器菜单裁切及测试未等待动画的失败与修正保存在外部验证记录，没有覆盖失败历史。

实际 Chromium/mock Light/Dark、1280×900 和 420×900 验证选择 High、保存/重开、Escape 和全选项可见；尺寸修正后仅更新受影响菜单截图，无横向溢出。应用资源 200，仅 fixture favicon 404，自有浏览器/进程与 QA 文件已清理，用户预览不动。独立 Standards/Spec 均 0；父代理核对最终局部菜单差异和截图。集成代理只核对 FF/祖先与 diff，未重跑测试、静态或浏览器；原 102 desktop 仅作基线，不称为最新全套通过。

ADR Coverage：沿用 spec 的 ADR-0035 桌面配置元数据持久化和 ADR-0029 包边界；server 组合已有 Session 接口，没有新增执行/恢复架构或领域含义。10 已 resolved；数字输入样式由新的 11 继续推进，spec 暂保留 claimed，不等待 CI，未启动 Electron。
