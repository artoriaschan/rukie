# 01：同步会话模型组件与已有会话视觉

Status: resolved

## 范围

按 [spec](../spec.md) 同步 C04/C06/C07 与既有会话功能，保留真实模型选择、取消、权限、上下文和输入行为。保护外围布局，覆盖模型选择、推理、键盘、主题、窄屏、长标签和滚动。

## Evidence

Pencil 读取确认：C06 VADXn/G3oddx，C07 DwmAJ/H2FoxR，H14 F1gPW；列表模型左侧品牌图标、右侧供应商和当前选择勾号。详情 hover/focus 更新，Esc 不提交。

实现复用已安装 beUI PromptInput/Button，组合现有 shadcn DropdownMenu 与 ScrollArea；click menu 采用 shadcn 的理由是其提供所需的菜单方向键和焦点恢复语义。模型能力、默认推理与显式推理选择保留，品牌路径由 Pencil 复制，自定义供应商保留通用图标。输入框、权限、上下文和正文尺寸同步，没有新增缺失功能入口。

公开行为复现、35个受影响 Chromium 用例、desktop 包级结果及审查增量证据见 [spec 验证记录](../spec.md#验证记录)。双轴审查问题均修复并复核，ADR Coverage 审阅完成。明暗及窄屏浏览器实测通过，资源清理完成。本地实现已完成，PR CI 待验收，未合并。
