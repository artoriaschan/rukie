# 09: 按当前 C16 清理高级配置表单

Status: claimed

Blocked by: 08

**What to build:** 对照用户当前 rukie.pen C16，移除添加/编辑模型弹窗中设计源不存在的智能配置、额外能力/兼容、参数映射及重置入口。保留设计中已有的自动压缩、运行参数与价格卡片，标题和说明同步设计；修改已有模型不丢失未呈现的配置字段。

- [ ] 通过 Pencil MCP 核对当前 C16 与公开表单，记录应保留及额外字段
- [ ] 仅修正该表单呈现，继续复用已有 beUI，删除过时前端状态与文案，保留持久化合同
- [ ] focused red/green 覆盖展开后的字段集合及编辑保存保留配置；静态验证一次
- [ ] 实际 Chromium/mock 验收仅检查受影响高级配置 Light/Dark/窄屏，不启动 Electron
- [ ] 独立评审、ADR Coverage 及证据完成后与 spec 同时关闭；复用已通过验证，不重复整套

## Implementation evidence

由新的 model_advanced_pencil09_fresh 子代理在独立工作树实施。最新用户要求与当前 C16 覆盖历史表单中智能配置、兼容/映射和重置入口的呈现要求；不改变已有模型持久化字段的合同。08 关闭后 spec 保持 claimed；初次 check:scratch 因本票尚未登记而失败，登记后仅复验 tracker，不重复代码测试。
