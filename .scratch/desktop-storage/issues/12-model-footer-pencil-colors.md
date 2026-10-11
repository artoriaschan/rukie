# 12: 模型弹窗底部按钮按 Pencil 配色

Status: resolved

Blocked by: 11

**What to build:** 按当前 C16 修复取消、保存按钮颜色。旧位置选择器覆盖保存主色，两按钮均呈灰色；取消按钮应为面板底色加描边，保存采用参考主色及文字色。保留 beUI Button、尺寸、键盘/焦点和保存/取消行为。

- [x] 通过 Pencil MCP 核对 Light/Dark 底部按钮及状态，更新所属设计规则
- [x] 清理冲突的旧位置颜色规则，用现有按钮角色控制颜色，不影响其他弹窗
- [x] 最小公开浏览器 red/green 覆盖实际按钮颜色与相关状态
- [x] 仅验收受影响 footer Light/Dark/窄屏，复用其他布局、保存及执行证据
- [x] 适用局部检查、独立复核和 ADR Coverage 完成后与 spec 同时关闭，不重复全套或 Electron

## Implementation evidence

由新的 footer_colors12_fresh 子代理在独立工作树实施。源码确认 model-services-modal-footer 的 button:nth-child(2) 颜色规则优先于保存按钮角色；Pencil C16 深色取消为 #2b2b2b、#ffffff1a 描边、#d4d4d4 文字，保存为白底黑字。验证记录归外部 rukie-footer-colors-evidence，由实施代理负责，父代理复用。

已修复旧 nth-child 颜色覆盖，取消采用 input surface 和描边，保存采用 primary/inverse 与 500 字重，两按钮 12px 圆角。保留 installed beUI Button，尺寸和业务行为不变。最小公开浏览器用例最终 1 pass / 15 filtered、1.30s；局部格式、lint 与 diff 检查通过。一次受影响 footer Chromium mock 验收覆盖 Light/Dark、1280/420 宽度、hover 和键盘焦点，无横向溢出。外部验证记录保留启动失败及诊断修复历史；未重跑包级、check:dev、全量或真实 Electron。父代理复用这些证据完成独立复核与关闭。

最终关闭：源码候选 `63884d0e` 已由新的 merger 快进集成，父代理只核对祖先、范围与证据，未重跑验证。新的 Standards/Spec 两项只读复核均零发现。ADR Coverage 对照最终差异完成：局部按钮配色、圆角与旧 CSS 清理沿用 ADR-0029/0035，无新增架构决定。测试中的临时依赖字体 403 不作为字体通过证据；实际隔离浏览器字体资源 200，仅缺失 favicon 404。12/spec 同步 resolved，以本地结果交付，不等待 CI，未授权合并 main。
