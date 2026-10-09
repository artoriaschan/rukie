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
