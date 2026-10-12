# 05：自动保存、服务开关、预设目录与协议联动

Status: claimed

Blocked by: 01, 02, 03, 04

**What to build:** 按 [spec 界面流程](../spec.md#界面流程)把供应商表单改为自动保存，删除输入校验，接入预设目录（P02 / L-P02）与新建服务的协议联动。

- [x] 添加供应商目录：依次显示"创建自定义供应商"与 `PROVIDER_PRESETS` 卡片，使用 `ProviderIcon` 的 Color 变体；卡片可用键盘操作，有可访问名称和焦点样式
- [x] 点击预设：立即保存服务（id 为 `deepseek`、`deepseek-2`…，名称为"DeepSeek"、"DeepSeek 2"…，`defaultApi` 变体，带 `icon`，`enabled: true`），然后选中该服务；"创建自定义供应商"同样立即保存
- [x] 协议联动：来源预设记在组件内存中，当前表单是新建服务时，切换 API 格式会替换为该变体的 Base URL 与模型并保存；切走或卸载后清除
- [x] 自动保存：Base URL 与 API Key 停止输入 500ms 后保存；切换服务、离开设置页、卸载时立即保存未保存的输入；开关、API 格式、模型增删、启停和编辑立即保存；保存请求串行执行，后到的修改不被先返回的结果覆盖
- [x] 删除表单底部的保存和取消按钮、`dirty` 分支、"已保存"状态，以及 `services.invalid` 与 `services.apiIncompatible` 的前置校验和文案；读取、保存、显示 Key、测试失败的提示保留，保存失败时保留输入
- [x] 服务开关读写 `enabled`，没有模型时也可以操作，停用不修改模型的 `enabled`
- [x] zh 和 en 文案同步增删
- [x] 测试（Chromium，脚本化 host，防抖使用虚拟时钟）：预设创建与 id、名称递增；协议联动与切走后不联动；在 499ms 和 500ms 两个时刻验证防抖边界；切换服务和卸载时立即保存；连续修改的保存顺序；没有保存按钮也没有校验提示；保存失败时保留输入；开关在没有模型时可操作并保留模型状态；取消或关闭弹窗不保存

## Comments

### Implementation evidence (2026-10-13)

- Fresh implementer and isolated branch `feat/provider-presets-05` from integration `d4ebcae3`; no reused agent. Reused installed beUI Button/Input/Select/Switch/Modal and shadcn menus; the acquisition URL is a semantic native anchor because no installed primitive or host external-link capability owns navigation. Its inline placement preserves the label/control geometry.
- Catalog immediately persists custom or DeepSeek services, allocates incrementing identities/names, retains the source preset only in current form memory, and swaps variants only while that source remains. API Key acquisition is keyboard accessible; Electron main opens only the exact fixed DeepSeek destination from the trusted app window/referrer and always denies app popups. The OS-opening rejection is handled; arbitrary addresses receive no native capability.
- Immutable snapshots serialize host saves. Debounced inputs flush at service selection, explicit return and unmount; immediate operations consume pending inputs. Saved responses update credential facts without resetting later edits. Failure keeps input; retries include the pending credential. Service enabled is independent from model flags and works without models. Model/rename confirmation remains explicit; cancel/close submits nothing. Frontend URL/compat/model/name validation and saved/footer copy removed; host schemas retain structural validation.
- Authorized Chromium seam used for TDD: catalog red missing preset; autosave red missing 500ms save; API Key link red missing destination. Final model-services file 28 passed in22.52s; incremental race/overview/link/Light-Dark wide-narrow geometry5 passed2.54s; strengthened link keyboard/geometry + protocol2 passed1.59s; explicit return-flush1 passed913ms. Native boundary red followed by12 main tests passed750ms under mocked Electron. Exact command/state/logs are in the shared verification record.
- Layout regression caught an unintended6px movement from the link wrapper; restored existing63px key group,4px gap,32px control and291px model list origin. No shared primitive geometry changes. New timing test uses a virtual clock at499/500ms and0ms microtask settlement. Dialog cancel case2.104s reflects four distinct real Chromium dialog/keyboard operations and observable close transitions, without fixed waits; no timer is used to decide cancellation success. Overview now flushes through an immediate toggle rather than waiting500ms.
- Full/static/docs/package/manual GUI checks remain coordinated by the integration and06 owners; no real credentials, real Electron, production request or user settings touched. Ticket remains claimed pending integrated review and final acceptance.

### Review fixes (2026-10-13)

- Fresh repair implementer on `fix/provider-presets-review`, based on integration `a6ce7041`, addressed all four review findings. Dialog saves track their originating editor and reject repeated submissions; obsolete completion or failure cannot close a reopened editor or display its errors there. Retrying a failed new model updates the original draft slot. Autosave remains editable. Saved-key reveals clear when saving begins without clearing typed replacement credentials. Selecting the current service flushes its queue while retaining pending or failed inputs. The fixed DeepSeek acquisition destination also accepts the empty referrer emitted by the existing `noreferrer` anchor, only while the app main frame is trusted; other addresses and nonempty untrusted referrers remain denied.
- Public Chromium regressions were red before implementation for stale model/rename completion, repeated submission, failed model retry, same-service draft retention and revealed-key save clearing. Native mock regression was red for an empty referrer. Focused browser coverage passed14 cases in9.29s; incremental dialog/model consumers and failed retry passed7 cases in7.87s. New cases take135–735ms. Native mocked main tests passed12 in813ms. No geometry, primitive or native acceptance scope changed.
- Repaired the new agent payload test's Request union overload and used the installed pi-ai simple API's omitted `reasoning` as its native off carrier; automatic Session policy remains unchanged. Payload tests passed10 in170ms. Scoped formatting/lint passed; affected ui/agent/desktop project typecheck passed1.581s. Full aggregate was not rerun; final policy, package and manual GUI verification remain coordinated by06. Exact commands, red/green logs and evidence invalidation scope are retained in the shared verification record. No real Electron, credentials, external navigation or production settings were used.
