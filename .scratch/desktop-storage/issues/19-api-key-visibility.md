# 19: API Key 遮罩与显示切换

Status: ready-for-agent

Blocked by: 18

用户截图指出模型服务 API Key 遮罩字符过疏、右侧显示/隐藏按钮未切换展示，并要求此按钮不增加 hover 动效。修复真实交互与遮罩样式，复用现有 beUI Input/Button，保持字段/页面布局和凭据所有权。仅使用受控假的 Key，不读取或输出用户真实秘密。

- [ ] 用最小公开浏览器接缝复现已保存/当前输入 Key 的展示切换缺陷
- [ ] 明确已保存 Key 的数据边界；实现展示/隐藏，遮罩紧凑，按钮无 hover 动效，保留 pointer 和键盘焦点
- [ ] 同步 DESIGN 局部例外及受影响合同/文案，修复不保存显示状态/泄露凭据到日志或截图
- [ ] 单一验证 owner：最小受影响测试、局部静态、一次 Chromium/mock Light/Dark/窄屏验收；审查/集成复用证据
- [ ] 新 Spec/Standards 两轴复核、fresh merger 集成，ticket/spec 同步关闭

不启动真实 Electron/Keychain，不跑包级/全量/CI。若触及 IPC/已保存秘密读取，应先查既有 credential 边界并遵守生产授权/来源验证，不建立明文持久副本或直接绕过 sidecar/main。
