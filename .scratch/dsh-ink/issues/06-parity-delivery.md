# 06: 回归验收、文档与移除旧 renderer

Status: resolved
Blocked by: none
Type: task

见 [spec](../spec.md) 与 [spike evidence](../spike-notes.md)。

完成全部 spec 的交付 gate。应用行为以 ADR-0006 与 pinned dsh-TUI 为准；保留公开行为覆盖，删去依赖旧实现的无效 unit tests，不删除仍有效的产品验收。

- [x] 完整移除旧 renderer/parser/selection/scroll/layout helpers 与旧 API/config/import，确认只有新 render path；ink/index.ts 没有兼容 facade
- [x] 注入终端验证尺寸/窄屏、resize reading position、bottom follow、copy selection/word/line/scroll、hit target、modal focus、pointer/wheel/key/paste、terminal restore/errors/signals
- [x] 验证多个渲染根 selection/search/退出写流隔离、真实 sixel/Kitty、graphics fallback/裁切/遮挡/预算/释放，以及 ADR-0012 模块边界
- [x] 审计每个 >1s focused case，消除可避免真实等待；记录必须保留的进程/SDK timing 理由；final full check 仅在最后变更及 focused pass 后执行一次
- [x] 更新 AGENTS/architecture/ink README/tech-stack 和受影响 owning docs，ADR13 accepted 与 ADR5 superseded 已由 spike 证据决定；核对链接、版本与实际行为
- [x] integration branch code-review 的 actionable findings 通过一个实现子代理修复；必要时重复受影响验证，记录原因
- [x] `env -u NO_COLOR bun run check` 通过，resolve 最后一张票与 spec 同一提交，记录当前证据，清理 rollout-owned 工单 worktrees

## Claim

04/05 已由父集成提交 2562b3f resolved。06 由 acceptance owner 牵头：renderer/scroll 九个旧测试文件、共享终端 helpers、文档与 manifest 审计；APP 负责 input/resize/text-style/lifecycle 四文件及 Text 显式 false 修复；images 负责 graphics。保留公开行为覆盖；review 与最后 aggregate gate 由父任务完成，当前不 resolve。

### 06 early public scroll acceptance

- Migrated source identity coverage to actual product `reading-position` hooks plus injected native ScrollBox: contraction, text remount, deferred element geometry, and containing-card fold fallback. The last case reproduced tail-21 instead of card-header before the owning fallback fix.
- Native DECSTBM scrolling reproduced a mismatch between painted row-1 and hit row-3; synchronize retained cached geometry and remove outgoing cache. Original click, clip, resize cancellation and hover assertions remain in `renderer/scroll-hit-geometry.test.tsx`.
- Shared terminal `waitFor` now has a real hrtime failure bound under virtual clocks, matching the bounded parse flush.
- Focused public helper/runtime/scroll-hit/source identity: 11 pass, 58 assertions, 428 ms; no aggregate gate yet. The remaining legacy migration, selection source-validation gaps, docs, review and final gate remain active.

- ScrollBox public growth → contraction → regrowth 迁移保留空白行和无 shell scrollback 断言。RED: 8×3 viewport 收缩为 `short` 后残留旧 `new3`；原因是 DECSTBM guard 比较恒为 viewport 高度的包装 Box，而不是实际 scroll extent。使用 `scrollHeight - prevScrollHeight` 后 7 个 ScrollBox + 2 个已迁移 scroll hit 测试 9/46 GREEN（288ms），无 Output/terminal facade。

### 06 旧公开断言迁移映射

| 原测试                                 | 保留的公开覆盖 / 撤销依据                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| render 11 cases                        | 原生注入 renderSync + AlternateScreen 保留 cells、grapheme、嵌套色彩/weight、keyed 重排、padding/border、换行、裁剪与无 scrollback；卸载后状态更新无新输出，恢复 shell 内容由 fullscreen/lifecycle 验证。                                                                                                                    |
| background-color half-block + NO_COLOR | half-block FG/BG、padding 与透明重绘仍在原文件；NO_COLOR 从修改已导入模块的环境变量迁移至 text-style 的真实隔离子进程 preimport startup matrix，保留半块字符两色平面与 emphasis。                                                                                                                                            |
| frame-diff 2 cases                     | 每个 cells 的 chars/width/FG/BG/flags/cursor/baseY 与 fresh full render 比较；撤销旧内部 byte-ratio 性能阈值，保留全 viewport/no-scrollback。                                                                                                                                                                                |
| frame-scheduling 2 cases               | 分离 React commits 的最终公开绘制、卸载后的 pending update 静默仍覆盖；原 16ms 单帧精确调度是已移除 renderer 实现细节。Static 中间追加机制撤销，实际 Session streaming/Transcript 顺序留在 TUI 验收。                                                                                                                        |
| hover 8 cases + Text click             | 2 个 scroll geometry cases 原断言移至 scroll-hit-geometry；其余 6 个原生 pointer/wheel/resize/React/detach cases 保留。Text inline click API 已删除，产品 InteractiveText 对实际可见 glyph、宽尾和裁掉 glyph 的真实点击由 interactive-text 4 cases 覆盖。                                                                    |
| fullscreen 7 cases                     | viewport/background、原始 shell 恢复、输入/鼠标/raw mode、浏览/继续跟随、大 Transcript 视口绘制保留 4 cases；width reflow/empty-line/source remount 移至 reading-position 的真实产品 source registry；runner process.emit cleanup 改由 terminal/lifecycle 的实际 Bun 子进程正常退出、SIGINT/SIGTERM、uncaught 双根恢复覆盖。 |
| scroll-box / selection-scroll          | 原生 ScrollBox 与 root selection hooks 保留 ancestor 裁剪、显式 seek、底部跟随、收缩/再增长、held wheel、source validation、soft-wrap Unicode/noSelect 与释放语义，不恢复旧 ScrollSnapshot 或 textSelection callback facade。                                                                                                |

Static 5 cases 加 frame-scheduling 中的 1 case 共 6 个旧机制撤销：keyed append-once 和 inline append/caret/resize 的 shell 历史协议不再由 renderer 提供，实际 Session Transcript/streaming 顺序、产品 TextInput history/caret/resize 由既有 TUI 与 design-system 公开测试保留；item margin 迁至 render 的 ordinary completed content vertical margins；padded border/wide/color 迁至 render 的 ordinary completed content border case；tall active growth/contraction/regrowth 迁至 scroll-box 的完整同名行为断言；intermediate Static append 调度改由当前 commit 最终绘制和 Session streaming 覆盖。生产图谱不含 Static facade。

- 剩余 renderer/fullscreen/产品 reading-position 迁移 focused 34/191 GREEN（981ms）；frame-diff 增加 strike/overline/blink/invisible 的逐 cell flags 比较后 2/38 GREEN（510ms）。fast scroll 修改影响的原 Session selection 文件 10/28 GREEN（1324ms，单 case 最大294ms）。类型前沿 `tsc -b` 与 Knip GREEN；3 个未消费 reading-position export 已收窄/删除，保留来源 Link 的 supports-hyperlinks 依赖采用明确单项 Knip exception。9 个改动文档的相对路径存在性核对通过。

- Images 的 native selection owner 修复整合后，原 selection-scroll 12 个迁移场景全部 12/28 GREEN（196ms）；选中源替换、滚回 capture debt、wide continuation 三个原 RED 保留原断言，不通过放宽文本结果。所有 renderer 来源 124 文件存在，直接按 manifest SHA-256 重算 37 个差异路径（native-ts index 计入，enums 原样），README 清单无重复。06 保持 claimed，最终 check:dev、两轴 review、review 修复与一次 aggregate 由集成阶段完成。

- Lead06 最终 affected scoped batch（13 个文件：原生 renderer 迁移、ScrollBox/selection、source position、helper/runtime 与多根 absolute removal）64/330 GREEN（1496ms），全部单 case <1s；日志由实际命令完成记录。未运行 aggregate，也未将 ticket/spec 标为 resolved。

## Answer

固定来源 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 的 ink/Yoga 已替换旧渲染栈。124 个来源文件全部存在并直接核对上游 SHA-256，37 个本地差异路径在 ink README 中各记录一次。应用、保留的 Rukie design-system/editor、注入流和真实 Kitty/sixel worker 采用原生路径，旧 API 与兼容 facade 已移除；ADR-0012 的 AST 目录边界通过。

旧公开行为迁移与撤销依据见本票上方映射。尺寸、窄屏、resize/source reading position、bottom follow、Unicode 选择与滚动来源校验、指针命中、键盘/paste、modal focus、图形遮挡/预算/释放、真实退出/信号与多根隔离均有当前公开入口验收。六个旧 Static 机制断言已逐项映射到有效产品或原生行为覆盖。

Standards 审查的两项说明问题与一项 helper 重复判断、Spec 审查的一个 offscreen NFC/NFD 来源校验缺陷，全部由同一个 APP 实现代理修复；独立合并验证通过。共享颜色资源的公开 RED 同时证明了混合终端 harness 的 ownership 问题，已修复。增量 Standards 审查通过，无未处理 actionable findings。

最终源代码状态 `eb7fb6d`：`env -u NO_COLOR bun run check` exit 0，格式、lint、types、Knip、scratch、ink boundaries 与全部测试通过；2885 pass、0 fail、16517 assertions、254 files，测试耗时 74.12s。此前完整 gate 的四项失败分别修复为 dim 继承、六条精确上游注释扫描例外、永久 Run Outcome 同步与 AlternateScreen 绘制完成同步；后者第二轮仍暴露发送指针早于绘制几何的顺序，新增实际 1049 输出/帧完成证据后复验通过。每次重复完整 gate 均由新变更或未解决失败触发，不沿用过期结果。

最终 focused 修复验证 42/456 与 AlternateScreen/lifecycle/runtime 18/154 均通过。最终完整负载中 coding-agent 唯一超过 1s 的通过用例为真实子进程 TERM→KILL 的 stopping jobs（3228ms）；父虚拟时钟不能推进该进程契约。可避免的前端等待均已改为虚拟截止时间或完成信号，原样本数与微任务顺序保留。

本任务全部实现 worktrees 已归档；最后三个 clean、已合入分支在确认 ancestry 后归档，四个剩余辅助分支已删除。集成分支 `codex/dsh-ink` 与无关 main/streaming-message-parity/rukie-theme-color 工作树保留。06 与 spec 在同一提交 resolved；此次关闭仅改状态与验证记录，不改变已通过 gate 的代码。
