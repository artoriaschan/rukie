# 大段文本拖选延迟修复

## 复现与原因

公开 renderer 与 xterm terminal fixture：120×40 viewport，一段 40 行或 2000 行原文，按下鼠标后在同一 stdin 批次连续发送 8 个拖选 motion。修改前分别耗时 136.92ms、131.78ms，均输出 8 帧；每个旧位置同步进行整帧绘制，积压在最新鼠标位置之前。

CPU profile 的主要采样落在 ANSI tokenizer、grapheme segmenter 与 sliceAnsi。来源校验为每个选中 cell 重复截取整行，即使原文及 wrapping 不变也重复工作。

## 实现与验证

- App 仅合并同一输入批次内同一按钮与 modifier 的连续文字拖选 motion。release、wheel/key、hover 与组件 drag 不合并，保持松开复制及下一次手势的边界。
- 来源列映射绑定已有 prepared text 版本，以 WeakMap 缓存原文行和按显示列索引的 grapheme；文本或 wrapping 变化时重新生成，避免逐 cell 重复分词。来源路径仍读取当前树，滚出屏幕的内容仍逐帧检查，替换拒绝复制规则保留。
- 相同 probe 修改后为 4.89ms、3.99ms，均输出 1 帧。这是本机注入 renderer 的性能证据，不代表特定物理终端的端到端延迟。临时 probe 已删除。
- 新增公开回归用例先得到 2 fail（期望 1 次输出，实际 8 次）；最终 3 pass、0 fail，12 assertions，145ms，覆盖 40/2000 行原文、最终高亮范围与松开后的复制、同批次松开再开始的新手势。
- selection、source validation、scroll 与 policy focused 25 pass、0 fail；全部 renderer 174 pass、0 fail、1187 assertions，4.58s；产品文字、手势、后台任务与 host selection 33 pass、0 fail、97 assertions，4.46s。
- `bun run check:dev`、`bun run check:docs` 与 `git diff --check` 通过。`env -u NO_COLOR bun run check` 的静态阶段及全部测试通过：3149 pass、0 fail、17962 assertions、287 files，106.67s。

## ADR coverage

沿用 ADR-0006 的选区与复制行为及 ADR-0013 的 renderer 归属。只优化输入批次与来源查询，不改变公开 API、选择策略、Transcript 或 host 剪贴板 transport。vendored renderer 的本地差异已记录在 ink README，无新的架构决定。

## 后续：多节点消息的分批拖选

用户再次报告大段消息拖选落后鼠标，指定对照 dsh-TUI。当前参考 checkout 为固定来源 3c89ea51：App 按鼠标事件更新 SelectionState，notifySelectionChange 同步 renderNow，renderFrame 对屏幕 cell 叠加选区并刷新字符指纹。参考实现没有 Rukie 为滚出视口后替换检测增加的逐 glyph DOM 来源查找。

上次 fixture 是一个 Text 的 40/2000 行，本次使用 160×50 viewport、2000 个独立 Text 节点，连续 8 次 motion 分别到达并等待各自的绘制完成。修改前每次更新 61.53–70.22ms；仅替换来源查询后，首次 10.18ms，后续 2.29–4.02ms。临时 probe 已删除；这些是注入 renderer/xterm 的本机结果，物理终端仍需用户确认。

根因是 paintedSourceRows 为每个选中 glyph 调用 hitTest(root)：一次 motion 读取消息容器 childNodes 11,071,096 次。改为每帧一次逆序遍历，构建选区行的屏幕 cell owner 索引；使用与原 hitTest 相同的未绘制节点跳过、裁剪和祖先外溢出规则，索引只存在于当前帧。原文版本缓存、滚出屏幕后的原文校验和复制契约保持原状。

新增回归通过公开 renderSync、Box ref 和 xterm 驱动分批 mouse 输入；用容器 childNodes 访问预算替代墙钟阈值，旧实现明确失败（实际 11,071,096，预算 20,000）。同时断言最终高亮边界、跨节点读取、held wheel 后保留 row-0、滚出屏幕的 row-0 原文被替换时拒绝复制。wheel/drain 使用虚拟时钟和 ScrollBoxHandle ref，与现有 scroll source fixtures 一致；初次 renderer 集合检查 174 pass/1 fail，失败在新 fixture 无 imperative ref 的 wheel 路由，补齐 ref 后前置文件与回归组合 12 pass/0 fail。

ADR review：遵循 ADR-0006 的选择与复制和 ADR-0013 的 vendored renderer 边界，无新公开接口、领域行为或架构决定；本地差异补充在 ink README。

后续验证：完整 renderer 175 pass/0 fail、1200 assertions、5.26s；产品选择相关 33 pass/0 fail、97 assertions、3.62s；check:dev 与 diff check 通过。一次最终 aggregate 实际结果为 3147 pass/3 fail、17958 assertions、287 files、122.82s，静态阶段通过，未重跑完整套件。

三个失败分别是 goal-recovery 的 pause queued Human answer 超过默认 5s（单例 148.44ms 通过，文件 16/0、3.06s）、subagent-history-boundary 的 future collision Resume 点击后等待 Agent View 超时（past/future 两例 2/0、1.26s）、jobs-panel 的 reading/follow 等待第三次模型调用超时（首次窄范围仍失败；HEAD 来源实现的对照通过，恢复新实现后的同例也通过，662.56ms）。这些场景未激活文字选区，新增 owner 索引不会执行；其最终等待也分别属于 Goal 调度、恢复面板点击和后续 prompt 接纳。本次未修改它们，保留未定位的间歇性超时记录；聚合检查仍为失败，窄范围通过不替代其结果。物理终端用户体验仍未人工验收。
