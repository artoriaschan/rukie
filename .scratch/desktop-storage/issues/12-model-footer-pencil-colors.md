# 12: 模型弹窗底部按钮按 Pencil 配色

Status: claimed

Blocked by: 11

**What to build:** 按当前 C16 修复取消、保存按钮颜色。旧位置选择器覆盖保存主色，两按钮均呈灰色；取消按钮应为面板底色加描边，保存采用参考主色及文字色。保留 beUI Button、尺寸、键盘/焦点和保存/取消行为。

- [x] 通过 Pencil MCP 核对 Light/Dark 底部按钮及状态，更新所属设计规则
- [x] 清理冲突的旧位置颜色规则，用现有按钮角色控制颜色，不影响其他弹窗
- [x] 最小公开浏览器 red/green 覆盖实际按钮颜色与相关状态
- [x] 仅验收受影响 footer Light/Dark/窄屏，复用其他布局、保存及执行证据
- [ ] 适用局部检查、独立复核和 ADR Coverage 完成后与 spec 同时关闭，不重复全套或 Electron

## Implementation evidence

由新的 footer_colors12_fresh 子代理在独立工作树实施。源码确认 model-services-modal-footer 的 button:nth-child(2) 颜色规则优先于保存按钮角色；Pencil C16 深色取消为 #2b2b2b、#ffffff1a 描边、#d4d4d4 文字，保存为白底黑字。验证记录归外部 rukie-footer-colors-evidence，由实施代理负责，父代理复用。

已修复旧 nth-child 颜色覆盖，取消采用 input surface 和描边，保存采用 primary/inverse 与 500 字重，两按钮 12px 圆角。保留 installed beUI Button，尺寸和业务行为不变。最小公开浏览器用例最终 1 pass / 15 filtered、1.30s；局部格式、lint 与 diff 检查通过。一次受影响 footer Chromium mock 验收覆盖 Light/Dark、1280/420 宽度、hover 和键盘焦点，无横向溢出。外部验证记录保留启动失败及诊断修复历史；未重跑包级、check:dev、全量或真实 Electron。父代理复用这些证据完成独立复核与关闭。
