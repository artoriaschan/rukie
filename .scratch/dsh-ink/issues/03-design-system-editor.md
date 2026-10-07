# 03: 改接 design-system 与通用输入编辑器

Status: ready-for-agent
Blocked by: 02
Type: task

见 [spec](../spec.md) 与 [spike evidence](../spike-notes.md)。

保留 Rukie design-system、主题、纯历史/编辑逻辑，全部基于 dsh 原语组合。dsh 没有 TextInput/Spinner，迁移 Rukie 编辑组件而非引入 excluded dsh components。不得保留旧 `tui-text` host、旧 cell renderer 或旧 API 适配层。

- [ ] themed、divider、status-icon、tooltip、list-item、split-diff、smooth-reveal 等使用新 Box/Text/hook；dimColor 改 dim，原 inline noSelect/click/softWrap 重构到实际新原语
- [ ] TextInput 基于 dsh Text/Box/useInput/useDeclaredCursor，保留 grapheme/caret、选区替换、编辑范围、atomic unit、highlight ranges、history draft/caret、回调及 async paste at live caret
- [ ] 验证 atomic click、普通/空白 click、wrap/resize、中文/emoji、只读编辑器、提交/多行/六行上限；新公共组件 seam 使用注入 headless terminal
- [ ] 保留 Spinner 产品组件，animation hook 的 interval/ref/tuple API 按新声明改接；保留 smooth reveal 自有调度
- [ ] 约定供 04 与 05 使用的新 public barrel 类型、stream mount 与 pointer events；全部组件不依赖 dsh theme/themePrefs/ui
- [ ] 修改/迁移受影响公共组件测试；focused test timings 记录，虚拟钟及完成信号符合根规则
