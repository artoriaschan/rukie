# 05: Pencil 模型服务录入流程

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 03

Status: claimed

- [ ] 读取 rukie.pen M17、C10–C17、P01–P08，记录流程和字段映射；先核对智能配置、高级输入/能力、推理等级与映射合同，缺口显式提出不假装支持
- [ ] 按原画板实现总览/目录/新供应商/地址与协议/密钥/添加编辑模型/模型行连接验证、删除与启用/重命名/删除确认；遵守当前 DESIGN.md 和组件来源，保持聊天布局
- [ ] 密钥走 host 受信任 IPC，非敏感配置和目录走相应合同；缺凭证可浏览，发送前配置模型，失败保留表单，取消不提交
- [ ] 保存后模型目录及新请求采用新配置，已开始请求保持快照；删除不破坏历史，失效引用要求重新选择，无供应商兜底
- [ ] Vitest browser mode 覆盖 P01–P08、焦点/键盘/zh/en/失败状态；focused/static 通过后真实浏览器 Light/Dark/窄窗口验收，使用假账号并关闭会话

## Implementation evidence

Claimed by dedicated issue05 agent; worktree `/tmp/rukie-desktop-storage-05`, branch `feat/desktop-storage-05`, based on integration tip `d9d31e2a`. Public seams authorized by this spec: model-service host configuration operations and rendered App browser interactions. Design read via Pencil MCP: M17 qYVTA, P01 ye0Me through P08 nS9de; source unchanged. Existing shell browser geometry cases provide unchanged chat baseline.

Protocol audit: locked pi-ai 1.0.4 BaseModel accepts text/image, not video/PDF. Session simple stream does not request structured response formats or native web tools, so these controls are unavailable with explanatory copy. Mid-conversation system messages use compat.supportsMidConvoSystemMessages. thinkingLevelMap maps canonical ascending off/minimal/low/medium/high/xhigh/max to provider strings; null means unsupported; xhigh/max require explicit maps. Intelligent configuration applies an explicit matching built-in catalog template; unknown IDs remain manual, never inferred. Existing compat values roundtrip unchanged.

Implemented P01–P08 with existing beUI Button/Input/Checkbox/Select/MorphingModal and shadcn DropdownMenu; the custom settings screen composes installed primitives because provider drafts and protocol fields are application-specific. SelectTrigger forwards an accessible label without geometry changes. zh/en copy covers unavailable fields and safe errors. Compatible protocol changes save; incompatible compat fields remain in the draft with an actionable error. Existing compat and native thinking maps survive edit/save. API keys are write-only with keep/delete/replace; saved ciphertext stays on the private host channel. Connection validation issues one short authenticated request through the actual locked adapter. Static catalog templates contain only non-sensitive fields and do not inspect terminal authentication.

Local verification: shell baseline10 cases passed6.77s before edit; affected model settings/shell/compact overlays16 browser cases passed6.57s after edit. The 4 settings browser scenarios pass in4.74s, with costs from real rendered keyboard/menu/modal interaction rather than fixed waits. Focused Core compatibility/input22 cases passed1.62s; focused private server/catalog/credential/model-selection2 cases passed0.30s including native high→deep reasoning payload. `bun run test:desktop` passed24 files/87 tests8.87s. `bun run check:dev` and `git diff --check` pass. No aggregate Core suite run; final aggregate belongs to06. No production system-encryption claim.

The unified real agent-browser Light/Dark/narrow acceptance is assigned to06 after04+05 integration. Prepared and launch-verified an external development harness at `/tmp/rukie-desktop-storage-evidence/browser-harness.ts`; it injects an isolated host, temporary OS-home/data root, private management token, and explicitly scripted nonproduction encryption. Its server exited and its temporary data root was removed. The source Pencil document remained unchanged. This issue stays claimed until review and the unified browser gate; its implementation is ready for integration.
