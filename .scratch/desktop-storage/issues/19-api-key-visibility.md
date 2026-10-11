# 19: API Key 遮罩与显示切换

Status: resolved

Blocked by: 18

用户截图指出模型服务 API Key 遮罩字符过疏、右侧显示/隐藏按钮未切换展示，并要求此按钮不增加 hover 动效。修复真实交互与遮罩样式，复用现有 beUI Input/Button，保持字段/页面布局和凭据所有权。仅使用受控假的 Key，不读取或输出用户真实秘密。

- [x] 用最小公开浏览器接缝复现已保存/当前输入 Key 的展示切换缺陷
- [x] 明确已保存 Key 的数据边界；实现展示/隐藏，遮罩紧凑，按钮无 hover 动效，保留 pointer 和键盘焦点
- [x] 同步 DESIGN 局部例外及受影响合同/文案，修复不保存显示状态/泄露凭据到日志或截图
- [x] 单一验证 owner：最小受影响测试、局部静态、一次 Chromium/mock Light/Dark/窄屏验收；审查/集成复用证据
- [x] 新 Spec/Standards 两轴复核、fresh merger 集成，ticket/spec 同步关闭

不启动真实 Electron/Keychain，不跑包级/全量/CI。若触及 IPC/已保存秘密读取，应先查既有 credential 边界并遵守生产授权/来源验证，不建立明文持久副本或直接绕过 sidecar/main。

## 实施与验证

用户确认已保存的 Key 也可主动显示；同步 ADR-0035 的原只写合同，展示仅限指定供应商 API Key 的受信任 IPC/私有 management/vault 通道。普通启动和列表不解密，OAuth/MCP/hook 秘密不可读取。列表遮罩压缩到 8 点并仅 password 使用现有 monospace 字体；右侧 beUI 按钮不响应 hover 颜色/背景/动画，保留 pointer、焦点和键盘切换。显示状态与输入草稿分开，隐藏、切换、保存、退出及过期请求清除，不自动写回明文。

公开 Chromium 回归先复现保存 Key 展示为空，修复后 2 个 focused 案例通过（1.57s）；Node/mock main/preload 2 案例通过（343ms），私有管理 HTTP 1 案例通过（18.77ms / 246ms），ui/desktop/server 类型、修改文件 lint、文档与测试策略通过。一次 agent-browser Light/Dark/420px 验收，假 Key 展示/隐藏、无 hover 动效、pointer 光标和无溢出通过；最终 8 点宽 67.43px、字段高 30px 保持。浏览器、Vite 和临时 fixture 均清理。未启动 Electron/Keychain，未跑包级、全量或 CI。证据由本票单一 owner 保存，审查和集成复用。

两轴 fresh review：Spec 仅原规格只写句子矛盾，已同步；Standards 仅新增 server fixture setup 的资源归属，已使用 ownResources acquire 与幂等关闭。ADR coverage：精确显示范围由用户确认并同步既有 ADR-0035，无其他架构决定变更。

- 交付：实现 d7d74130；新 Spec 旧规格合同 P2 与 Standards 测试清理 P2 已集中修正，父代理核对最终差异、测试与截图关闭发现；fresh merger 仅快进集成，复用验证。19/spec 同步 resolved，本地交付不等待 CI，真实 Electron/Keychain 未验收，PR 未合并。
