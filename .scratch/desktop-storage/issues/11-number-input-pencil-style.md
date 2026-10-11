# 11: 模型数字输入隐藏原生增减按钮

Status: claimed

Blocked by: 10

**What to build:** 用户截图中的数字增减按钮来自 beUI Input 内部 type=number 的原生外观。按当前 Pencil，在模型弹窗范围隐藏原生按钮，保留数字输入、最小值校验和键盘调整，不改变共享 Input 或其他页面。

- [ ] 在所属设置样式中隐藏上下文窗口和最大输出 Token 的原生按钮
- [ ] 最小公开浏览器回归验证按钮外观、尺寸及数字/键盘合同
- [ ] 仅验收受影响输入区域，复用其余默认等级与执行证据；不启动 Electron
- [ ] 文档与局部格式/lint 检查、差异复核、ADR Coverage 和本地证据完成后与 spec 同步关闭

## Implementation evidence

由新的 numeric_spinner11_fresh 子代理在独立工作树实施。继续使用已安装 beUI Input，不把其内部 HTML input 当作组件来源替换；只处理浏览器原生 type=number 外观。
