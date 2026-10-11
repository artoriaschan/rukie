# 05: Pencil 模型服务录入流程

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 03

Status: ready-for-agent

- [ ] 读取 rukie.pen M17、C10–C17、P01–P08，记录流程和字段映射；先核对智能配置、高级输入/能力、推理等级与映射合同，缺口显式提出不假装支持
- [ ] 按原画板实现总览/目录/新供应商/地址与协议/密钥/添加编辑模型/模型行连接验证、删除与启用/重命名/删除确认；遵守当前 DESIGN.md 和组件来源，保持聊天布局
- [ ] 密钥走 host 受信任 IPC，非敏感配置和目录走相应合同；缺凭证可浏览，发送前配置模型，失败保留表单，取消不提交
- [ ] 保存后模型目录及新请求采用新配置，已开始请求保持快照；删除不破坏历史，失效引用要求重新选择，无供应商兜底
- [ ] Vitest browser mode 覆盖 P01–P08、焦点/键盘/zh/en/失败状态；focused/static 通过后真实浏览器 Light/Dark/窄窗口验收，使用假账号并关闭会话
