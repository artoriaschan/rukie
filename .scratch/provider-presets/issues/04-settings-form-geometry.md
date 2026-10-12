# 04：设置区表单间距、输入高度与圆角

Status: ready-for-agent

**What to build:** 按 [spec 设置区样式](../spec.md#设置区样式)和已确认的 rukie.pen C11、C16 统一设置区表单几何，同步 DESIGN.md。这是用户授权的布局变化，按 [DESIGN.md 布局保护规则](../../../DESIGN.md#layout-preservation)执行。

- [ ] 改动前在 Chromium 测量基线：C11 三组字段的标签与输入框位置和高度、模型列表起点；C16 各字段组；宽屏与窄屏，Light 与 Dark
- [ ] 补齐缺失的布局用例，断言标签到控件 4px、输入框与 Select 高 32px、圆角 8px、C11 模型列表起点 291px；Checkbox 与 Radio 选项外框圆角 8px、高 28px；弹窗按钮保持 12px
- [ ] 修改 `model-services.css`、beUI Input/Select 在设置区的作用域样式，以及 C16 选项外框样式；不改变设置区以外 A02/A03 消费者的几何
- [ ] DESIGN.md "Model services settings"同步数值：30px 改 32px，36px 控件与 60px 字段组改 32px 与 54px，64px 字段组重复间距改 69px，276px 改 291px，标签间距 4px，表单控件圆角 8px
- [ ] 运行设置区布局回归（`model-services.browser.test.tsx`、`layout.browser.test.tsx`，以及 shell 中涉及设置区的用例），记录基线、授权差异与实测结果

## Comments
