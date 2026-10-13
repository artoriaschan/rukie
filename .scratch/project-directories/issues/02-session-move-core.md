# 02：Agent Core Session Move 与跨移动回退

Status: ready-for-agent

Blocked by: None (can start immediately)

**What to build:** 按 [spec](../spec.md#session-move) 在 Agent Core 的 store 能力中增加移动接口，在 Run 中告知模型工作目录变化，并按 [spec](../spec.md#跨越移动的回退) 禁止恢复移动之前的代码。

- [ ] store 新增移动接口：取得写入租约，追加 Session Move 记录（旧 cwd、新 cwd），更新会话元数据 cwd，释放租约；不创建 Session、不调度 Resume、不解析模型或凭据
- [ ] 存储缺失或 cwd 不匹配返回 `session-not-found`，租约占用返回 `session-busy`，二者都不改动数据；JSONL 存储明确拒绝
- [ ] 下一次 Run 由最新且未告知的 Session Move 记录生成 system reminder，并补发新目录环境快照；同一记录只告知一次，Resume 后行为一致
- [ ] `rewind` 选中的 prompt 早于最近一次 Session Move 时拒绝恢复代码并返回明确错误码，对话回退仍可用
- [ ] TUI 回退选择器在该情况下禁用“恢复代码”并显示原因，zh 与 en 同步
- [ ] ADR 记录 Session cwd 可改绑与移动记录规则（见 01 的 ADR 说明）；CONTEXT.md 新增 Session Move 词条并修订 Session 词条
- [ ] 测试：公开 store 接口与 `createSession` 覆盖移动写入、租约占用、Resume 后 reminder 与快照、不重复告知、跨移动回退；TUI 回退选择器终端断言
