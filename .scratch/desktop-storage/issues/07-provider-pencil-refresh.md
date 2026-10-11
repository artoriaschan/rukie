# 07: 更新供应商页面与模型弹窗

Status: claimed

Blocked by: 05

**What to build:** 按用户维护的 rukie.pen 当前 P01–P08 和组件更新供应商界面及添加/编辑模型弹窗；新增供应商仅提供自定义入口，移除界面中的预设供应商；滚动条采用 A13 自定义样式，优先组合已有 beUI 组件。

- [ ] 经 Pencil MCP 核对 P01–P08、相关 C 组件和 A13，记录当前尺寸与状态
- [ ] 编辑前记录浏览器布局基线，更新授权的供应商与模型弹窗布局，保持聊天区域不变
- [ ] 添加供应商仅自定义，协议选择、凭据保留/替换/删除及模型配置合同保持一致
- [ ] 自定义滚动条验证滚轮、拖拽、键盘、长内容和窄屏，避免原生滚动条重复显示
- [ ] focused/browser/static、Light/Dark/窄屏人工浏览器验证及独立评审通过；不启动真实 Electron
- [ ] 核对 ADR Coverage，关闭本票和 spec；以适用本地结果交付，无需等待 CI

## Implementation evidence

新代理 provider_pencil_refresh_new 独立实现本票，从 integration `8d68c1cc` 建立独立工作树/分支，完成后由新 merger 整合。源设计仅通过 Pencil MCP 读取，不修改设计文件。组件来源、布局测量与实际本地验证结果待完成后填写。
