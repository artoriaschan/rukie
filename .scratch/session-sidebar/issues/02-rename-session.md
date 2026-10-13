# 02：重命名 Session

Status: ready-for-agent

Blocked by: 01

**What to build:** 按 [spec](../spec.md#重命名) 让用户从会话菜单重命名任意 Session：打开“重命名聊天”弹窗，保存后标题固定为用户来源；重命名未打开的 Session 时不打开 Session、不触发 Session Resume。

- [ ] Agent Core store 能力新增只写标题接口：只取得该 Session 的存储写入租约，写入会话元数据标题与 `title-source` Tool State 的 user 值后立即释放；复用 Tool State 版本与写入规则和 Session Title 规范化；不创建 Session、不调度恢复、不解析模型或凭据；租约被占用时返回 session-busy 且不写入
- [ ] 新增 wire 命令 `session.rename { sessionId, title }`：Session 已在本服务打开时调用其 `rename`；否则调用只写标题接口；成功后发出 `sessions_changed`；空标题与不存在的 Session 返回错误
- [ ] 重命名弹窗按用户截图：标题“重命名聊天”，副标题“保持简短且易于识别”，输入框预填当前标题、全选并聚焦；去首尾空白后为空或未变化时保存禁用；Enter 保存，Esc、关闭按钮与取消关闭不修改；提交中防重复；失败时保留弹窗并显示错误，`session_busy` 显示“会话被占用”
- [ ] 会话行右键、行内更多与标题栏“会话更多”加入“重命名”
- [ ] zh 与 en 文案同步
- [ ] 测试：store 层验证只写标题后只读列表与 Session Resume 都得到 user 来源标题且不再被自动标题覆盖、租约占用时不写入；server 测试覆盖已打开与未打开两种路径、未打开路径不产生 Run 或任务恢复、`session_busy`；shell browser 覆盖弹窗交互、保存禁用、键盘、失败保留与菜单入口
