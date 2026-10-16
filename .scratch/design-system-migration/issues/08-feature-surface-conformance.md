# 08：功能页面逐节符合性与写法清理

Status: resolved
Blocked by: 03, 04, 05

**What to build:** 按 DESIGN.md 的「Workspace and page composition」各小节，逐页核对已实现页面的几何、token 和交互，清理剩余的字面值和任意值，并加一道静态门禁防止回退。依据 [spec](../spec.md) 中「功能页面」一节。

## 任务

- [x] 逐节核对以下页面的实测几何，结论写入 Comments，不符合的项按规范修复。

  | 页面                     | 核对项                                                                                |
  | ------------------------ | ------------------------------------------------------------------------------------- |
  | 壳层                     | 52/44/268px、4px 内缩、12px 内角、分隔线、工作区阴影                                  |
  | 导航                     | 透明行、ScrollArea 8/4/24px、头部分隔线                                               |
  | 对话                     | 736/752px、composer 100px 高 / 16px 圆角、滚动条 12/24px、Preview Rail 20/8/6/24/40px |
  | 模型选择器               | 28px 触发器，列表 332px / 32px 行 / 最高 312px，详情 280px，672px 断点                |
  | 权限与上下文面板         | 376px、348px                                                                          |
  | 搜索                     | 520px、20px 壳圆角、31px 结果行、160ms 入场                                           |
  | Project 悬停详情与对话框 | 320px / 12px；480/416/520/448px                                                       |
  | 新聊天选择条             | 40px、288/320px 菜单                                                                  |
  | Worktree                 | 32px 刷新按钮、12px 行、448px 删除对话框                                              |
  | Goal                     | 28px 工具栏、40px 状态条、448px 移除对话框                                            |
  | Plan                     | 44+248px 预览、752px Interaction 卡、300px 摘要、Plan Side Pane 的 960px 断点         |

- [x] 功能 CSS 中的 hex 字面值改为 token。`components/conversation-controls.css` 有 22 处。`theme.css` 中功能样式部分的字面值也要处理，例如 `.conversation-summary-*`、`.plan-pane*`、`.session-row-title`。
- [x] 硬编码的 `font-size` 和 `line-height`（例如 `.conversation-summary-*` 中的 `line-height: 1.5`）改为 `text-ui-*` 角色。
- [x] 分散的 `z-0`、`z-10`、`z-20`、`z-30` 改为层级 token，层级 owner 是 `lib/overlay.ts`。层级顺序为：结构 → 被动提示 → 模态 → 交互菜单。
- [x] 任意圆角值改为具名角色：
  - `command-palette.tsx` 中的 `rounded-[20px]`：改为搜索壳的具名局部角色。
  - `agent-progress.tsx` 中的 `rounded-[1px]`。
  - 其余 `-[Npx]` 任意值：属于规范点名尺寸的保留，并在 Comments 中写明对应的规范条目；其余改为共享角色。
- [x] 图标：检查覆盖 Lucide 图标尺寸的写法，例如 `size-4` 写在 svg 上。字形统一为 12px，槽位和点击区是另外的尺寸。
- [x] GUI 中不显示快捷键提示、keycap 或组合键后缀。逐页检查，搜索框和菜单也包括在内。
- [x] 把 `scripts/check-ui-typography.ts` 的检查范围扩展到 `packages/ui/src/**/*.css` 中的 `font-size` 字面值（允许引用 `--text-ui-*` 和 `--text-code`），并补充对应的拒绝样本测试。
- [x] 测试：在各功能 browser 套件中补齐规范点名尺寸的几何断言，覆盖 Light、Dark、420px、18px 字号和 zh/en。运行受影响的文件和 `bun run check:dev`。
- [x] 用 agent-browser 做最终的整体验收：覆盖上表全部页面，在 Light、Dark 和 420px 下截图，检查控制台与网络。
- [x] 本 ticket 是 spec 的最后一张。关闭时完成 spec 的 ADR Coverage 审阅，并把 spec 一并设为 resolved。

## Comments

### Authorization and baseline (77c87701)

| Region             | Before                                                      | Authorized result                                                                                        |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Feature colors     | Ten local Light/Dark conversation literals                  | Shared placeholder, warning, link and inverse semantic roles                                             |
| Feature typography | Literal line heights and redundant Search glyph override    | Existing size role paired with its line-height; 12px glyph                                               |
| Stacking/search    | Numeric local/structural classes; arbitrary search radius   | Named roles in overlay.ts preserving existing numeric order; named 20px search shell                     |
| New chat branch    | Tooltip wrapper/percentage sizing can collapse label to 0px | Meaningful branch label at wide/420px/18px; retain 40px bar and 288/320px menus                          |
| Goal removal       | Trash clears immediately; enable dialog is separate         | Frontend removal confirmation: 448px/r16, body20v24h, separate footer, Cancel32/Delete36, initial Cancel |
| Static typography  | TS/TSX only                                                 | CSS declaration-aware font-size role gate                                                                |

All unlisted geometry remains protected within 1px. Public seams are the existing App/component browser suites and exported checkUiTypography function, as agreed in the spec. Existing package failure evidence is retained: ticket07 original desktop run 370 pass/1 fail (Project menu opened then closed); later probes do not reclassify that run.

Typography authorization detail: model facts use the12/16 small role (old12/18), so successive fact offsets56/80 and reasoning-action146 migrate to56/78/140; context title/base20 and model/small16 migrate the context bar108→105px. The fixed280px detail/184px envelope,376px permission shell and348px context shell remain protected. Settings text adopts matching role line heights while retaining fixed header/footer/field regions.

Summary base-role line-height20 replaces21: first row offset45→44px;300px card and32px rows are retained. Goal removal footer aligns32px Cancel centrally alongside36px Delete instead of flex stretch. Citation public Chromium probe confirms native actionable links and nested content already compute pointer; no link production change required.

Settings role migration evidence: empty-provider description21→20px, action offset312→311px; model-list offset291→290px stays within protected1px; default-reasoning label18→16px yields52px group (32px field+4px join+16px label). Narrow Permission menu previously touched right viewport edge;16px collision clearance now applies without changing376px shell.

The settings two-line runtime label now occupies32px instead of36px under the12/16 role, so its shared group72→68px; the32px input and4px join remain unchanged. API popup vertical shift330→329px remains within1px baseline tolerance.

The existing settings provider-removal description is two small-role lines:18→16px line-height makes modal180→176px and centered top520→522px. This is a typography-authorized content-height change;448px width/action/footer regions stay unchanged.

Final GUI audit found single-choice Interaction aria-hidden numeric1–4 markers mirrored actual bindings. Per DESIGN’s no-shortcut-hints rule, retain28px circle/row geometry and actual bindings but replace its digit with the actual selected Check glyph12px (empty when unselected). Public Plan Review reject-digit test fails before the change; affected Question/Plan cases and manual surface recapture follow. This is the sole runtime source change after the initialcheck:dev gate.

### 逐节符合性结论

| 页面        | 实测与公开测试证据                                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 壳层        | layout公开用例保持52/44/268、4px内缩/12px内角与原阴影；Light1280与Dark420/18均通过。最终Chromium三类shell-selector截图和computed记录一致。                                                                                                                                                                         |
| 导航        | layout补齐8px轨/4px拇指/≥24px拇指，resting/current行透明；头部随内部滚动显示分隔线。最终30个真实wire创建的临时Session使导航出现滚动，实测8/4px；三类navigation截图。                                                                                                                                               |
| 对话        | 实测宽屏内容736、composer752/100/r16；scrollbar公开断言12/≥24；Preview Rail公开实测20px偏移、8px项、6/24px刻度和40pxgutter，最终preview-rail三类截图。                                                                                                                                                             |
| 模型        | 实测28px触发、332px列表、32px行/312上限、280px详情；补齐671/672精确断点和16px清隙。窄屏详情实测332px，与列表一致；三类model截图。                                                                                                                                                                                  |
| 权限/上下文 | 实测376/348px，补齐420/18 zh/en无溢出与可达操作；权限菜单新增16px collision clearance；三类permission/context截图。                                                                                                                                                                                                |
| 搜索        | 实测520px/r20/16px清隙；结果≥31px；公开浏览器原生动画duration160ms、DOM采样scale0.98→1且无平移、reduced-motion即时切换通过；三类search-results截图。                                                                                                                                                               |
| Project     | hover实测320/r12；Create480/Edit520/Remove448/r16，420/18长名称与可见底栏；三类project-*截图。Trust416经实际Chromium mock-host公开流程通过；真实侧车手工选择目录会触发原生picker，未调用，不能声称真实416路径验收。                                                                                                |
| 新聊天      | 实测40px条、288/320px菜单；18px en/zh标签、实际Project选择/独立worktree创建与分支标签可见；三类shell-selector/branch-menu截图。                                                                                                                                                                                    |
| Worktree    | 实测Refresh32、行r12/p12v16h/g12、删除448/r16/Cancel32/Delete36；公开错误/忙碌/取消与最终实际删除后空状态通过；三类worktree/worktree-remove截图。                                                                                                                                                                  |
| Goal        | 实测28工具模式、40状态条、448/r16删除确认/body20v24h/separatefooter/Cancel32/Delete36。真实held模型流中Escape保留Goal并返回Trash焦点，Pause显示paused，确认clear移除bar并返回输入；释放当前流后无后续Goal轮次。三类goal-*截图。                                                                                    |
| Plan        | preview44+248、Interaction752/r16、Summary300；Plan pane main-width959/960精确断点公开通过；三类plan-review-final/summary/plan-pane截图。实际初次live未显示评审，reload+Search恢复后批准并完成，后续fresh Plan live0.4s显示并完成；两者证据分开，原因未分类。实际fresh Question立即显示，多选键盘/指针提交并完成。 |

原票22处conversation颜色是初始基线描述，前票已清理12处，本票清理余下10处；agent-progress及其1px圆角已由05删除，不重新迁移。剩余规范点名任意尺寸保留，非规范局部尺寸已在DESIGN具名并映射shared theme角色。Citations公开链接鼠标和Enter路径通过，未增加无必要的生产修复。

验证：一次check:dev全通过（155篇docs、470个test/fixture policy）；CSS门禁15例通过。受影响功能证据按[验证记录](../verification.md)增量复用；最后keyhint变更4文件28例1.79s、绑定/12px glyph单例622ms，changed格式/lint/tsc/Knip/policy/typography通过。几何新增3例2.22s和2个导航例1.64s通过。未重新跑desktop/check，不把先前失败改写为通过。

最终隔离Chromium使用临时配置、内存加密和loopback假模型；当前源码08的@fs路径确认。Light/Dark/420-18逐行截图、console无产品错误、errors为空、648条网络记录资源均200。Search拍摄期间一次agent-browser挂起并自动重启，doctor8pass/0warn/0fail；保留此工具限制，后续重新连接同一真实侧车继续验收，未据此改产品。初次Plan实时缺失经独立fresh read-only诊断仍未分类，Core/client/store/server owners相对迁移基线无改动；保留为手工验收限制。

清理：实际UI删除本次独立工作树并见空状态；Git fixture根05982fd、状态干净且仅一个worktree后精确移除。命名浏览器关闭；launcher46683/sidecar46688/Vite46748/provider46967退出，63244/63250/IPv45173无监听；保留无关IPv6 Vite29894。未启动Electron/钥匙串/原生目录选择器。

本票与spec保持claimed，交由fresh Standards/Spec评审；评审修复完成后由新的实现代理一起关闭。ADR coverage已按完整实现补齐，包含nativeTheme宿主边界与前端Goal确认；无新增持久化或协议取舍。

### 最终评审修复与关闭

Fresh Standards与Spec两轴各报告同一项P2 Goal删除确认身份问题，无其他具体发现。新的单一实现代理修复全部评审项：迟到clear响应不能关闭同Session重开、跨Session或同Session新Goal的确认；焦点意图绑定确认身份并支持authoritative状态先于响应。取消待响应弹窗仅结束呈现，已发送命令不伪装为撤销，合同已写入DESIGN。公开回归先失败2例，最终Goal18例通过9.15s；wire client7例有效复用。首次实测焦点失败及barrier fixture失败均保留，修复后真实侧车确认clear返回Prompt，三类Goal截图与无console/network错误证据完成。增量静态、文档、tracker检查通过，未例行重跑包或check:dev。完整两轴结论、RED/GREEN、复用边界和限制见[验证记录](../verification.md#最终评审修复与关闭)。

完成spec的ADR Coverage最终审阅：ui分层与nativeTheme宿主边界沿用ADR-0029，Goal确认/Trace读者身份均属临时Frontend呈现，不引入Core、wire、持久化、信任或生命周期取舍，无需新增ADR。本票与spec同变更resolved；PR与CI交付状态不等同本地完成，先前失败和原生限制不改写为通过。
