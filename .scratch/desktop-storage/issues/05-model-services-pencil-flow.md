# 05: Pencil 模型服务录入流程

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 03

Status: claimed

- [x] 读取 rukie.pen M17、C10–C17、P01–P08，记录流程和字段映射；先核对智能配置、高级输入/能力、推理等级与映射合同，缺口显式提出不假装支持
- [x] 按原画板实现总览/目录/新供应商/地址与协议/密钥/添加编辑模型/模型行连接验证、删除与启用/重命名/删除确认；遵守当前 DESIGN.md 和组件来源，保持聊天布局
- [x] 密钥走 host 受信任 IPC，非敏感配置和目录走相应合同；缺凭证可浏览，发送前配置模型，失败保留表单，取消不提交
- [x] 保存后模型目录及新请求采用新配置，已开始请求保持快照；删除不破坏历史，失效引用要求重新选择，无供应商兜底
- [x] Vitest browser mode 覆盖 P01–P08、焦点/键盘/zh/en/失败状态；focused/static 通过后真实浏览器 Light/Dark/窄窗口验收，使用假账号并关闭会话

## Implementation evidence

Claimed by dedicated issue05 agent; worktree `/tmp/rukie-desktop-storage-05`, branch `feat/desktop-storage-05`, based on integration tip `d9d31e2a`. Public seams authorized by this spec: model-service host configuration operations and rendered App browser interactions. Design read via Pencil MCP: M17 qYVTA, P01 ye0Me through P08 nS9de; source unchanged. Existing shell browser geometry cases provide unchanged chat baseline.

Protocol audit: locked pi-ai 1.0.4 BaseModel accepts text/image, not video/PDF. Session simple stream does not request structured response formats or native web tools, so these controls are unavailable with explanatory copy. Mid-conversation system messages use compat.supportsMidConvoSystemMessages. thinkingLevelMap maps canonical ascending off/minimal/low/medium/high/xhigh/max to provider strings; null means unsupported; xhigh/max require explicit maps. Intelligent configuration applies an explicit matching built-in catalog template; unknown IDs remain manual, never inferred. Existing compat values roundtrip unchanged.

Implemented P01–P08 with existing beUI Button/Input/Checkbox/Select/MorphingModal and shadcn DropdownMenu; the custom settings screen composes installed primitives because provider drafts and protocol fields are application-specific. SelectTrigger forwards an accessible label without geometry changes. zh/en copy covers unavailable fields and safe errors. Compatible protocol changes save; incompatible compat fields remain in the draft with an actionable error. Existing compat and native thinking maps survive edit/save. API keys are write-only with keep/delete/replace; saved ciphertext stays on the private host channel. Connection validation issues one short authenticated request through the actual locked adapter. Static catalog templates contain only non-sensitive fields and do not inspect terminal authentication.

Local verification: shell baseline10 cases passed6.77s before edit; affected model settings/shell/compact overlays16 browser cases passed6.57s after edit. The 4 settings browser scenarios pass in4.74s, with costs from real rendered keyboard/menu/modal interaction rather than fixed waits. Focused Core compatibility/input22 cases passed1.62s; focused private server/catalog/credential/model-selection2 cases passed0.30s including native high→deep reasoning payload. `bun run test:desktop` passed24 files/87 tests8.87s. `bun run check:dev` and `git diff --check` pass. No aggregate Core suite run; final aggregate belongs to06. No production system-encryption claim.

The unified real agent-browser Light/Dark/narrow acceptance is assigned to06 after04+05 integration. Prepared and launch-verified an external development harness at `/tmp/rukie-desktop-storage-evidence/browser-harness.ts`; it injects an isolated host, temporary OS-home/data root, private management token, and explicitly scripted nonproduction encryption. Its server exited and its temporary data root was removed. The source Pencil document remained unchanged. This issue stays claimed until review and the unified browser gate; its implementation is ready for integration.

After merging integration `1913e9f4` (04) into issue05 (`ff423157`), combined `bun run test:desktop` passed25 files/89 tests9.05s; server file passed22 tests2.28s; `check:dev` passed. Final settings return-focus correction is verified by5 focused browser scenarios4.99s, including the public App seam preserving the draft and main-region geometry within1px while restoring keyboard focus to its opener. C10–C17 were read explicitly through Pencil MCP in addition to M17/P01–P08. No architecture decision beyond ADR-0035 is introduced; API limitations follow the locked adapter rather than adding conversions or request capabilities.

Integrated acceptance on runtime candidate `4d3cf021`: unified real browser Light/Dark/420px and keyboard/focus/console checks passed. Fresh displayed-model first send, provider deletion plus sidecar restart with historical full-output pagination, and explicit replacement-model continuation passed after public regression fixes. Independent Standards/Spec review completed and documentation finding corrected. Final closure remains coordinated with 06 genuine native acceptance and spec.

Final closure: integrated implementation, independent review and applicable local verification complete. Unified browser and genuine packaged acceptance are recorded in [06](06-integration-and-packaged-acceptance.md); spec/tickets close together after that gate. Prior aggregate environment failures remain recorded separately from passing focused follow-up. Final documentation commit CI remains pending until observed on the PR.

## Corrective follow-up

2026-10-11 用户报告每次启动出现钥匙串/密码授权窗口，以及设置页未严格还原 Pencil。重新打开 03、05、06 与 spec，分别由新的子代理诊断启动凭证访问并对照实际画板修正设置布局/样式；历史验收记录保留，最终关闭需完成本轮回归与原生/浏览器验收。
