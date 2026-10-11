# 08: 修复 API 格式下拉框样式

Status: claimed

Blocked by: 07

**What to build:** 修复用户本机预览发现的 API 格式下拉框圆点、行高和悬停色回归，继续优先复用已有 beUI Select，按当前 rukie.pen P04/C14 及 DESIGN.md 验收。

- [ ] 通过实际浏览器预览入口复现截图，建立能捕获 marker/尺寸/颜色的最小公开 DOM 测试
- [ ] 区分组件、样式作用域、预览入口与测试环境根因，不把 registry 来源当作样式正确的证明
- [ ] 修复所属层并核对所有受影响 Select 消费者，保持聊天布局与配置合同
- [ ] focused/static、独立评审与实际浏览器展开菜单 Light/Dark/窄屏/键盘选择通过
- [ ] 记录实际本地 desktop/check:dev 与 ADR Coverage，同步关闭工单/spec，不等待 CI，不启动真实 Electron

## Implementation evidence

独立新代理 provider_api_dropdown_fix_new 从 integration `694ad40b` 建立 worktree/branch。用户当前预览生成的未跟踪 packages/ui/__qa.tsx 及其进程保留，不参与提交或清理。后续证据记录在外部 provider-dropdown-evidence 目录。
