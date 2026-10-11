# 08: 修复 API 格式下拉框样式

Status: resolved

Blocked by: 07

**What to build:** 修复用户本机预览发现的 API 格式下拉框圆点、行高和悬停色回归，继续优先复用已有 beUI Select，按当前 rukie.pen P04/C14 及 DESIGN.md 验收。

- [x] 通过实际浏览器预览入口复现截图，建立能捕获 marker/尺寸/颜色的最小公开 DOM 测试
- [x] 区分组件、样式作用域、预览入口与测试环境根因，不把 registry 来源当作样式正确的证明
- [x] 修复所属层并核对所有受影响 Select 消费者，保持聊天布局与配置合同
- [x] focused/static、独立评审与实际浏览器展开菜单 Light/Dark/窄屏/键盘选择通过
- [x] 记录实际本地 desktop/check:dev 与 ADR Coverage，不等待 CI，不启动真实 Electron

## Implementation evidence

独立新代理 provider_api_dropdown_fix_new 从 integration `694ad40b` 建立 worktree/branch。用户当前预览生成的未跟踪 packages/ui/__qa.tsx 及其进程保留，不参与提交或清理。后续证据记录在外部 provider-dropdown-evidence 目录。

`5f36dfca` 保留已有 beUI Select，将裸 li 的容器改为显式重置的合法 ul；实际入口的 disc marker 和额外 21px 高度由生产 CSS 隔离 iframe 用例先红后绿捕获。设置作用域按当前 C14 恢复 624×96px 菜单、28px 行、2px 间距、4px 内缩和 16px 勾选，悬停采用中性色；聊天 Select 消费者另有回归覆盖。实际 Chromium/mock 验收完成 Light/Dark、420px、Enter 选择和 Escape 收起，无横向溢出；字体及应用资源 200，仅预览 favicon 404，未启动 Electron。

本地集成 `5f36dfca` 的 desktop 为 26 文件、102 pass（11.83s），check:dev 通过。初始 focused 16 pass（10.22s）。独立 Standards 初评 0；Spec 要求追加 API hover 颜色覆盖，新代理 `86893fec` 增加 Light/Dark 背景、文字、选中与几何断言，受影响文件 13 pass（10.95s）；临时删除 scoped hover 后两例失败，恢复生产 CSS 后通过。最终 Spec 0；Standards 发现主题初始化/卸载失败的恢复遗漏，另一新代理 `a6f2f0bd` 先注册 onTestFinished 并用嵌套 finally 修复，父代理检查差异确认关闭该发现，仅两例复验 2 pass（1.93s）。该最小复验有临时依赖链接的字体 allow-list 警告，链接已清理；不将其当作字体验收。生产源码未再次变化，复用已有浏览器、desktop 和静态证据，没有重复全套。此前集成端对 hover 文件及静态检查的重复运行记录保留，不再重复。

ADR Coverage：沿用 spec 中 ADR-0029/0035；本轮只修改所属 UI 内列表结构、局部样式和回归测试，不改变依赖、配置合同、凭据、持久化或执行生命周期，无需新 ADR。08 已完成本地交付；用户随后提出高级配置偏差，作为新的 09 继续推进，spec 保持 claimed。
