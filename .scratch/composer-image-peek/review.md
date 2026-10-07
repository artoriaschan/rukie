# Composer image peek 验收

2026-10-07。集成分支：`codex/composer-image-peek`；起点：`3e8c2a1`；最终代码：`3950234`。

## 实现

01 光标预览、02 Esc 关闭、03 显示拦截依赖图已完成，票据均 resolved。TextInput 报告吸附后的 UTF-16 光标并支持 inverse highlight；Chat 从既有 composer 绑定派生单图被动卡，保持输入与发送行为。小终端或非 chat 视图返回后恢复光标；模态预览、Interaction 与面板优先。

## Standards

初审一项 P2：TUI README 缺少 Esc 关闭/重新显示、显示条件与恢复契约。`a1df559` 补齐；只读复核确认已解决，无新增 Standards 发现。

## Spec

初审一项 P2：80×12 正常终端消息视口较矮，卡片没有文字占位。`a1df559` 将文字占位与图形尺寸门槛分开，并新增 80×12 / 40×12 e2e，断言文字在输入框上方、状态行仍显示，以及 resize 后完整元数据。复核确认已解决，无新增规格问题。初审另有 P3 roadmap 实施记录缺失，本次更新已补齐。

## 验证

- 01 red→green：光标停在 token 起始位置原本无卡；31 个图片相关 e2e 通过，集成分支独立复跑 6.07s。
- 02 red→green：首次 Esc 原本清空草稿；覆盖 Run AbortSignal、第二次 Esc 中断、同块左右移动后恢复、另一 token 和草稿保留。
- 03 red→green：审批卡被遮挡，resize 后光标重置到草稿末尾；覆盖审批/提问恢复、折叠提问、两个 small 阈值、Dashboard、模态优先和选择器/Rewind 公共入口。Slash Command 提交会清空草稿，面板关闭后验证空 composer。
- 三张票集成后独立执行新功能三文件：11 pass / 0 fail，2.42s；审查修复后的相关图片测试 29 pass / 0 fail，5.42s。新增用例均低于一秒。
- 最终代码 `3950234`：`env -u NO_COLOR bun run check` 退出 0，格式、lint、类型、Knip 和全量测试通过；2512 pass / 0 fail，14098 assertions，184 files，测试阶段 74.47s。

验证不依赖真实 provider 或用户配置；测试通过 app start/headless terminal 与 fake model 公共接缝。未进行真实 Kitty 终端人工验收；既有 placement/协议测试包含于全量门禁。最终门禁后仅更新 Markdown 交付证据，单独验证格式、引用路径和 diff。

## Main integration

2026-10-07：main 从 `3e8c2a1` 快进到 `585cb2d`；功能代码与全量门禁 `3950234` 完全一致。main checkout 独立执行三个 composer image e2e 文件：13 pass / 0 fail，48 assertions，2.58s。仅交付 Markdown 后续更新，按文档规则验证格式与 diff，无需重复全量测试。确认 feature 相对 main 无未合并提交且 worktree 干净后，清理本次集成 worktree 与分支，保留其他并行工作。
